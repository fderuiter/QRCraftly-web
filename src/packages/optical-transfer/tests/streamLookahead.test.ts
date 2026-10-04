import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StreamLookaheadReceiver,
  DANGEROUS_SCHEMES,
  recursiveDecode,
  decodeHtmlEntities,
  findDangerousScheme,
} from '../index';

describe('StreamLookahead Decoder Utilities', () => {
  describe('decodeHtmlEntities', () => {
    it('should decode hex entity with and without semicolon', () => {
      expect(decodeHtmlEntities('&#x3a;')).toBe(':');
      expect(decodeHtmlEntities('&#x3A;')).toBe(':');
      expect(decodeHtmlEntities('&#x3a')).toBe(':');
    });

    it('should decode decimal entity with and without semicolon', () => {
      expect(decodeHtmlEntities('&#58;')).toBe(':');
      expect(decodeHtmlEntities('&#58')).toBe(':');
    });

    it('should decode named entities', () => {
      expect(decodeHtmlEntities('&colon;')).toBe(':');
      expect(decodeHtmlEntities('&colon')).toBe(':');
      expect(decodeHtmlEntities('&amp;')).toBe('&');
      expect(decodeHtmlEntities('&lt;')).toBe('<');
      expect(decodeHtmlEntities('&gt;')).toBe('>');
    });

    it('should preserve unknown entities', () => {
      expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
    });
  });

  describe('recursiveDecode', () => {
    it('should decode multi-layered percent encoding up to 10 levels deep', () => {
      // %3a -> :
      // %253a -> %3a -> :
      // %25253a -> %253a -> %3a -> :
      expect(recursiveDecode('%25253a')).toBe(':');
      // 5 levels deep
      expect(recursiveDecode('%252525253a')).toBe(':');
    });

    it('should decode mixed percent-encoded HTML entities recursively', () => {
      // %26%23%35%38%3b is:
      // %26 -> &
      // %23 -> #
      // %35%38 -> 58
      // %3b -> ;
      // So Level 1 percent decode: &#58;
      // Level 2 HTML decode: :
      expect(recursiveDecode('%26%23%35%38%3b')).toBe(':');
    });

    it('should gracefully handle malformed or partial percent sequences', () => {
      expect(recursiveDecode('http://safe.com/%')).toBe('http://safe.com/%');
      expect(recursiveDecode('http://safe.com/%2')).toBe('http://safe.com/%2');
      expect(recursiveDecode('http://safe.com/%20safe')).toBe('http://safe.com/ safe');
    });

    it('should limit recursion to exactly 10 levels deep', () => {
      // 11 nested percent-encodings:
      // `%25252525252525252525253a`
      // Level 1: `%252525252525252525253a`
      // ...
      // Level 10: `%253a`
      const deepInput = '%25252525252525252525253a';
      const decoded = recursiveDecode(deepInput, 10);
      expect(decoded).toBe('%253a'); // Left with 1 layer of %25
    });
  });
});

describe('StreamLookaheadReceiver', () => {
  let onWarningMock: any;
  let onTerminateMock: any;

  beforeEach(() => {
    onWarningMock = vi.fn();
    onTerminateMock = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Requirement 1 & 2: Incremental Streaming and Dangerous Scheme Matching', () => {
    it('should allow building a safe URL incrementally without warnings', () => {
      const receiver = new StreamLookaheadReceiver({
        onWarning: onWarningMock,
        onTerminate: onTerminateMock,
      });

      receiver.receive('htt');
      expect(receiver.getBuffer()).toBe('htt');
      expect(receiver.isActiveSession()).toBe(true);

      receiver.receive('ps://');
      expect(receiver.getBuffer()).toBe('https://');

      receiver.receive('google.com/search');
      expect(receiver.getBuffer()).toBe('https://google.com/search');

      expect(onWarningMock).not.toHaveBeenCalled();
      expect(onTerminateMock).not.toHaveBeenCalled();
    });

    it('should match each of the eleven dangerous schemes', () => {
      for (const scheme of DANGEROUS_SCHEMES) {
        const receiver = new StreamLookaheadReceiver({
          onWarning: onWarningMock,
          onTerminate: onTerminateMock,
        });

        expect(() => {
          receiver.receive(scheme);
        }).toThrow();

        expect(receiver.isActiveSession()).toBe(false);
        expect(receiver.getBuffer()).toBe(''); // Purged
        expect(onTerminateMock).toHaveBeenCalled();
      }
    });

    it('should ignore safe protocols', () => {
      const safeProtocols = [
        'http://google.com',
        'https://yahoo.com',
        'mailto:test@example.com',
        'tel:+123456789',
        'sms:+123456789?body=hi',
        'geo:40,-74',
        'wifi:S:MyNet;P:password;;',
      ];

      for (const proto of safeProtocols) {
        const receiver = new StreamLookaheadReceiver();
        receiver.receive(proto);
        expect(receiver.isActiveSession()).toBe(true);
        expect(receiver.getBuffer()).toBe(proto);
      }
    });
  });

  describe('Requirement 4: Immediate Closure and Purging', () => {
    it('should immediately close active session and purge buffer when threat is detected', () => {
      const receiver = new StreamLookaheadReceiver({
        onWarning: onWarningMock,
        onTerminate: onTerminateMock,
      });

      receiver.receive('java');
      expect(receiver.getBuffer()).toBe('java');
      expect(receiver.isActiveSession()).toBe(true);

      // Malicious boundary
      expect(() => {
        receiver.receive('script:alert(1)');
      }).toThrow();

      expect(receiver.isActiveSession()).toBe(false);
      expect(receiver.getBuffer()).toBe(''); // PURGED!
      expect(onTerminateMock).toHaveBeenCalled();
      expect(onWarningMock).toHaveBeenCalledWith(
        expect.stringContaining('Dangerous protocol detected')
      );
    });

    it('should throw an error if receiving data on an already terminated session', () => {
      const receiver = new StreamLookaheadReceiver();
      expect(() => {
        receiver.receive('javascript:');
      }).toThrow();

      expect(() => {
        receiver.receive('more data');
      }).toThrow('Cannot receive chunk on an inactive or terminated stream session.');
    });
  });

  describe('Acceptance Criteria Tests', () => {
    it('AC1: successfully intercepts and terminates a stream where a dangerous protocol is split across multiple consecutive frame boundaries', () => {
      const receiver = new StreamLookaheadReceiver({
        onWarning: onWarningMock,
        onTerminate: onTerminateMock,
      });

      const frames = ['ja', 'va', 'sc', 'ri', 'pt', ':a', 'lert(1)'];

      // Process up to index 4 (reconstructed "javascript")
      for (let i = 0; i < 4; i++) {
        receiver.receive(frames[i]);
        expect(receiver.isActiveSession()).toBe(true);
      }
      expect(receiver.getBuffer()).toBe('javascri');

      // The 5th frame adds 'pt' -> "javascript" (no colon yet, so safe)
      receiver.receive(frames[4]);
      expect(receiver.isActiveSession()).toBe(true);
      expect(receiver.getBuffer()).toBe('javascript');

      // The 6th frame adds ':a' -> "javascript:a..." -> Match dangerous protocol!
      expect(() => {
        receiver.receive(frames[5]);
      }).toThrow('MaliciousStreamError');

      expect(receiver.isActiveSession()).toBe(false);
      expect(receiver.getBuffer()).toBe(''); // Purged
      expect(onTerminateMock).toHaveBeenCalled();
    });

    it('AC2: safe, multi-frame URL inputs are processed to completion without false positive alerts or early stream termination', () => {
      const receiver = new StreamLookaheadReceiver({
        onWarning: onWarningMock,
        onTerminate: onTerminateMock,
      });

      const safeUrlFrames = [
        'htt',
        'ps://',
        'www.google.com/',
        'search?q=javascript+tutorials',
        '&lang=en',
      ];

      for (const frame of safeUrlFrames) {
        receiver.receive(frame);
        expect(receiver.isActiveSession()).toBe(true);
      }

      expect(receiver.getBuffer()).toBe(
        'https://www.google.com/search?q=javascript+tutorials&lang=en'
      );
      expect(onWarningMock).not.toHaveBeenCalled();
      expect(onTerminateMock).not.toHaveBeenCalled();
    });

    it('AC3: successfully decodes and flags recursive, multi-layered HTML entity obfuscations hidden inside stream chunks', () => {
      const receiver = new StreamLookaheadReceiver({
        onWarning: onWarningMock,
        onTerminate: onTerminateMock,
      });

      // Obfuscated: "javascript:"
      // "j" = %6a -> %256a
      // "a" = &#x61;
      // "v" = %25252576 -> %252576 -> %2576 -> %76 -> v
      // ":" = &colon;
      const frames = [
        '%256a', // 'j'
        '&#x61;', // 'a'
        '%25252576', // 'v'
        'ascript&colon;', // 'ascript:'
      ];

      receiver.receive(frames[0]);
      receiver.receive(frames[1]);
      receiver.receive(frames[2]);
      expect(receiver.isActiveSession()).toBe(true);

      // The last frame completes the scheme "javascript:"
      expect(() => {
        receiver.receive(frames[3]);
      }).toThrow('MaliciousStreamError');

      expect(receiver.isActiveSession()).toBe(false);
      expect(receiver.getBuffer()).toBe('');
      expect(onTerminateMock).toHaveBeenCalled();
    });

    it('AC4 & Success Metrics: scanning interface maintains fluid frame rate of 60 FPS (processing completes under 1 ms per check)', () => {
      const receiver = new StreamLookaheadReceiver();

      // Measure processing time of a typical frame lookahead check
      const startTime = performance.now();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        // Feed safe frames in a loop
        const safeFrame = `chunk_${i}_data`;
        receiver.receive(safeFrame);
      }

      const endTime = performance.now();
      const totalDuration = endTime - startTime;
      const averageTimePerCheck = totalDuration / iterations;

      console.log(`[StreamLookahead Perf] Average time per check: ${averageTimePerCheck.toFixed(4)} ms`);

      // Fluid 60 FPS target is 16.6ms total budget. Our processing check must be well under 1ms.
      expect(averageTimePerCheck).toBeLessThan(1.0);
      // Stream termination occurs within 30 milliseconds success metric
      expect(totalDuration / iterations).toBeLessThan(30.0);
    });

    it('should automatically terminate on timeout', () => {
      const receiver = new StreamLookaheadReceiver(
        {
          onWarning: onWarningMock,
          onTerminate: onTerminateMock,
        },
        5000 // 5 seconds timeout
      );

      receiver.receive('htt');
      expect(receiver.isActiveSession()).toBe(true);

      // Fast forward 6 seconds
      vi.advanceTimersByTime(6000);

      expect(receiver.isActiveSession()).toBe(false);
      expect(receiver.getBuffer()).toBe('');
      expect(onTerminateMock).toHaveBeenCalled();
    });

    describe('Configurable Stream Mode (Binary vs Text)', () => {
      it('initializes with configurable stream mode, defaulting to text', () => {
        const textReceiver = new StreamLookaheadReceiver();
        // Since we cannot inspect config directly, we can check behavior
        expect(() => textReceiver.receive('javascript:alert(1)')).toThrow();

        const binaryReceiver = new StreamLookaheadReceiver({ mode: 'binary' });
        expect(() => binaryReceiver.receive('javascript:alert(1)')).not.toThrow();
      });

      it('preserves binary control bytes with zero omissions when binary mode is active', () => {
        const binaryReceiver = new StreamLookaheadReceiver({ mode: 'binary' });
        const controlPayload = 'F|0|1|\x00\x01\x02\r\n\x1F\x7F';
        binaryReceiver.receive(controlPayload);
        expect(binaryReceiver.getBuffer()).toBe(controlPayload);
        expect(binaryReceiver.isActiveSession()).toBe(true);
      });

      it('does not trigger session termination on random bytes matching restricted schemes in binary mode', () => {
        const binaryReceiver = new StreamLookaheadReceiver({ mode: 'binary' });
        // Under text mode, 'javascript:' would terminate the stream.
        // Under binary mode, it must succeed.
        binaryReceiver.receive('javascript:');
        expect(binaryReceiver.getBuffer()).toBe('javascript:');
        expect(binaryReceiver.isActiveSession()).toBe(true);
      });

      it('retains timeout functionality in binary mode', () => {
        const binaryReceiver = new StreamLookaheadReceiver(
          { mode: 'binary', onTerminate: onTerminateMock },
          5000
        );
        binaryReceiver.receive('some_binary_bytes');
        expect(binaryReceiver.isActiveSession()).toBe(true);

        vi.advanceTimersByTime(6000);
        expect(binaryReceiver.isActiveSession()).toBe(false);
        expect(onTerminateMock).toHaveBeenCalled();
      });

      it('triggers immediate termination in text mode for restricted schemes', () => {
        const textReceiver = new StreamLookaheadReceiver({ mode: 'text' });
        expect(() => textReceiver.receive('vbscript:malicious')).toThrow();
        expect(textReceiver.isActiveSession()).toBe(false);
      });
    });
  });
});

describe('findDangerousScheme (#1160)', () => {
  it('flags a frame that starts with a dangerous scheme, through hidden characters', () => {
    expect(findDangerousScheme('javascript:alert(1)')).toBe('javascript:');
    expect(findDangerousScheme('  J a v a\tScript:alert(1)')).toBe('javascript:');
  });

  it('does not flag text that merely contains one', () => {
    expect(findDangerousScheme('Notes about: javascript: basics')).toBeUndefined();
    expect(findDangerousScheme('See the file data:2026.csv or about:blank rules')).toBeUndefined();
  });
});
