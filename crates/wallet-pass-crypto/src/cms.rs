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

//! CMS SignedData (RFC 5652) creation in pure Rust (`no_std`).

use crate::der::{
    algorithm, child_at, context_tag, integer_from_bytes, integer_from_u32, octet_string, oid,
    read_children, read_der_all, sequence, set_of, tag, time_generalized, time_utc,
};
use crate::rsa::{rsa_sign_sha256_pem};
use crate::sha256::Sha256;
use crate::zeroize::ZeroizingVec;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

pub mod cms_oids {
    pub const DATA: &str = "1.2.840.113549.1.7.1";
    pub const SIGNED_DATA: &str = "1.2.840.113549.1.7.2";
    pub const CONTENT_TYPE: &str = "1.2.840.113549.1.9.3";
    pub const MESSAGE_DIGEST: &str = "1.2.840.113549.1.9.4";
    pub const SIGNING_TIME: &str = "1.2.840.113549.1.9.5";
    pub const SHA256: &str = "2.16.840.1.101.3.4.2.1";
    pub const RSA_ENCRYPTION: &str = "1.2.840.113549.1.1.1";
}

pub struct ParsedCertificateInfo {
    pub der: Vec<u8>,
    pub serial_number: Vec<u8>,
    pub issuer: Vec<u8>,
}

pub fn parse_cert_info(der: &[u8]) -> Result<ParsedCertificateInfo, String> {
    let certificate = read_der_all(der).map_err(|_| "Invalid certificate DER.".to_string())?;
    let tbs = child_at(&certificate, 0, Some(tag::SEQUENCE)).map_err(|_| "Invalid TBS Certificate.".to_string())?;
    let fields = read_children(&tbs).map_err(|_| "Invalid TBS fields.".to_string())?;

    let at = if fields.first().map(|f| f.tag) == Some(0xa0) { 1 } else { 0 };
    let serial = fields.get(at).ok_or("Missing serial number.")?;
    let issuer = fields.get(at + 2).ok_or("Missing issuer.")?;

    if serial.tag != tag::INTEGER || issuer.tag != tag::SEQUENCE {
        return Err("Unexpected certificate field tags.".to_string());
    }

    Ok(ParsedCertificateInfo {
        der: der.to_vec(),
        serial_number: serial.value.clone(),
        issuer: issuer.bytes.clone(),
    })
}

pub fn format_time_der(time_sec: i64) -> Vec<u8> {
    // Break down timestamp into year, month, day, hour, min, sec (UTC)
    let secs = if time_sec < 0 { 0 } else { time_sec as u64 };
    let days = secs / 86400;
    let mut rem_secs = secs % 86400;
    let hour = (rem_secs / 3600) as u8;
    rem_secs %= 3600;
    let min = (rem_secs / 60) as u8;
    let sec = (rem_secs % 60) as u8;

    // Simplified Gregorian calendar conversion
    let mut year = 1970u16;
    let mut day_count = days;

    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if day_count < days_in_year {
            break;
        }
        day_count -= days_in_year;
        year += 1;
    }

    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let days_in_months = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];

    let mut month = 1u8;
    for &dim in &days_in_months {
        if day_count < dim {
            break;
        }
        day_count -= dim;
        month += 1;
    }
    let day = (day_count + 1) as u8;

    if year >= 1950 && year < 2050 {
        time_utc(year, month, day, hour, min, sec)
    } else {
        time_generalized(year, month, day, hour, min, sec)
    }
}

pub fn sign_detached_cms(
    content: &[u8],
    signer_der: &[u8],
    chain_ders: &[&[u8]],
    key_pem: &str,
    time_sec: i64,
) -> Result<ZeroizingVec, String> {
    let signer_info = parse_cert_info(signer_der)?;

    let content_hash = Sha256::digest(content);
    let time_der = format_time_der(time_sec);

    let attr_content_type = sequence(&[&oid(cms_oids::CONTENT_TYPE)?, &set_of(&[&oid(cms_oids::DATA)?])]);
    let attr_signing_time = sequence(&[&oid(cms_oids::SIGNING_TIME)?, &set_of(&[&time_der])]);
    let attr_msg_digest = sequence(&[&oid(cms_oids::MESSAGE_DIGEST)?, &set_of(&[&octet_string(&content_hash)])]);

    let signed_attributes = set_of(&[&attr_content_type, &attr_signing_time, &attr_msg_digest]);

    let signature = rsa_sign_sha256_pem(key_pem, &signed_attributes)?;

    let mut implicit_attributes = signed_attributes;
    implicit_attributes[0] = 0xa0;

    let signer_identifier = sequence(&[&signer_info.issuer, &integer_from_bytes(&signer_info.serial_number)]);
    let sha256_alg = algorithm(cms_oids::SHA256)?;
    let rsa_alg = algorithm(cms_oids::RSA_ENCRYPTION)?;

    let signer_info_der = sequence(&[
        &integer_from_u32(1),
        &signer_identifier,
        &sha256_alg,
        &implicit_attributes,
        &rsa_alg,
        &octet_string(signature.as_slice()),
    ]);

    let mut all_certs_der = Vec::new();
    all_certs_der.extend_from_slice(signer_der);
    for chain in chain_ders {
        all_certs_der.extend_from_slice(chain);
    }

    let signed_data = sequence(&[
        &integer_from_u32(1),
        &set_of(&[&sha256_alg]),
        &sequence(&[&oid(cms_oids::DATA)?]),
        &context_tag(0, &[&all_certs_der]),
        &set_of(&[&signer_info_der]),
    ]);

    let content_info = sequence(&[&oid(cms_oids::SIGNED_DATA)?, &context_tag(0, &[&signed_data])]);

    Ok(ZeroizingVec::from_vec(content_info))
}
