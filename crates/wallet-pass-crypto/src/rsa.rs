/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//! RSA PKCS#1 v1.5 key parsing and SHA-256 signature calculation with memory zeroization.

use crate::biguint::BigUint;
use crate::der::{read_children, read_der_all, tag};
use crate::pem::private_key_to_pkcs8;
use crate::sha256::Sha256;
use crate::zeroize::{zeroize_bytes, ZeroizingVec};
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub struct RsaPrivateKey {
    pub n: BigUint,
    pub e: BigUint,
    pub d: BigUint,
    pub k: usize,
}

const SHA256_DIGEST_INFO_PREFIX: [u8; 19] = [
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
    0x00, 0x04, 0x20,
];

pub fn parse_rsa_key_der(der_bytes: &[u8]) -> Result<RsaPrivateKey, String> {
    let top = read_der_all(der_bytes).map_err(|_| "Invalid DER in private key.".to_string())?;
    if top.tag != tag::SEQUENCE {
        return Err("Invalid DER sequence in private key.".to_string());
    }
    let top_children = read_children(&top).map_err(|_| "Invalid DER children.".to_string())?;

    // Check if this is PKCS#8 (3 fields) or PKCS#1 (9+ fields)
    let pkcs1_bytes = if top_children.len() >= 3 && top_children[2].tag == tag::OCTET_STRING {
        &top_children[2].value
    } else {
        der_bytes
    };

    let pkcs1_top = read_der_all(pkcs1_bytes).map_err(|_| "Invalid PKCS#1 key.".to_string())?;
    let fields = read_children(&pkcs1_top).map_err(|_| "Invalid PKCS#1 fields.".to_string())?;
    if fields.len() < 4
        || fields[1].tag != tag::INTEGER
        || fields[2].tag != tag::INTEGER
        || fields[3].tag != tag::INTEGER
    {
        return Err("Invalid RSA private key structure.".to_string());
    }

    let n = BigUint::from_bytes_be(&fields[1].value);
    let e = BigUint::from_bytes_be(&fields[2].value);
    let d = BigUint::from_bytes_be(&fields[3].value);
    let k = n.bit_len().div_ceil(8);

    if k < 64 {
        return Err("RSA key length too short.".to_string());
    }

    Ok(RsaPrivateKey { n, e, d, k })
}

pub fn rsa_sign_sha256_pem(key_pem: &str, message: &[u8]) -> Result<ZeroizingVec, String> {
    let pkcs8 = private_key_to_pkcs8(key_pem)?;
    let rsa_key = parse_rsa_key_der(pkcs8.as_slice())?;
    rsa_sign_sha256(&rsa_key, message)
}

pub fn rsa_sign_sha256(key: &RsaPrivateKey, message: &[u8]) -> Result<ZeroizingVec, String> {
    let hash = Sha256::digest(message);

    let mut t = Vec::with_capacity(SHA256_DIGEST_INFO_PREFIX.len() + hash.len());
    t.extend_from_slice(&SHA256_DIGEST_INFO_PREFIX);
    t.extend_from_slice(&hash);

    if key.k < t.len() + 11 {
        return Err("RSA key too small for PKCS#1 v1.5 padding.".to_string());
    }

    let ps_len = key.k - t.len() - 3;
    let mut em = ZeroizingVec::with_capacity(key.k);
    em.push(0x00);
    em.push(0x01);
    for _ in 0..ps_len {
        em.push(0xff);
    }
    em.push(0x00);
    em.extend_from_slice(&t);

    let m = BigUint::from_bytes_be(em.as_slice());
    let s = m.mod_pow(&key.d, &key.n);

    let sig_bytes = s.to_bytes_be_pad(key.k);
    let res = ZeroizingVec::from_vec(sig_bytes);

    zeroize_bytes(&mut em);
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rsa_signature_math() {
        // Small 1024-bit RSA key or math check
        // p = 61, q = 53 => n = 3233, e = 17, d = 2753
        let n = BigUint::from_u32(3233);
        let e = BigUint::from_u32(17);
        let d = BigUint::from_u32(2753);
        let key = RsaPrivateKey { n, e, d, k: 64 };

        let msg = b"test message";
        let hash = Sha256::digest(msg);
        let m = BigUint::from_bytes_be(&hash).div_rem(&key.n).1;

        let s = m.mod_pow(&key.d, &key.n);
        let v = s.mod_pow(&key.e, &key.n);

        assert_eq!(v.cmp(&m), core::cmp::Ordering::Equal);
    }
}
