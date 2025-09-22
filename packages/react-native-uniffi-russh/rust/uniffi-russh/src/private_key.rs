use rand::rngs::OsRng;
use russh::keys::ssh_key::{
    self,
    private::{Ed25519Keypair, KeypairData},
};
use russh_keys::{Algorithm, EcdsaCurve};

use crate::utils::SshError;

use base64::Engine as _;

#[derive(Debug, Clone, Copy, PartialEq, uniffi::Enum)]
pub enum KeyType {
    Rsa,
    Ecdsa,
    Ed25519,
    Ed448,
}

#[uniffi::export]
pub fn validate_private_key(private_key_content: String) -> Result<String, SshError> {
    // Normalize and parse once; return canonical OpenSSH string.
    let (canonical, _parsed) = normalize_openssh_ed25519_seed_key(&private_key_content)?;
    Ok(canonical)
}

#[uniffi::export]
pub fn generate_key_pair(key_type: KeyType) -> Result<String, SshError> {
    let mut rng = OsRng;
    let key = match key_type {
        KeyType::Rsa => russh_keys::PrivateKey::random(&mut rng, Algorithm::Rsa { hash: None })?,
        KeyType::Ecdsa => russh_keys::PrivateKey::random(
            &mut rng,
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP256,
            },
        )?,
        KeyType::Ed25519 => russh_keys::PrivateKey::random(&mut rng, Algorithm::Ed25519)?,
        KeyType::Ed448 => return Err(SshError::UnsupportedKeyType),
    };
    Ok(key
        .to_openssh(russh_keys::ssh_key::LineEnding::LF)?
        .to_string())
}

// Best-effort fix for OpenSSH ed25519 keys that store only a 32-byte seed in
// the private section (instead of 64 bytes consisting of seed || public).
// If the input matches an unencrypted OpenSSH ed25519 key with a 32-byte
// private field, this function returns a normalized PEM string with the
// correct 64-byte private field (seed || public). Otherwise, returns None.
pub(crate) fn normalize_openssh_ed25519_seed_key(
    input: &str,
) -> Result<(String, russh::keys::PrivateKey), russh::keys::ssh_key::Error> {
    // If it already parses, return canonical string and parsed key.
    if let Ok(parsed) = russh::keys::PrivateKey::from_openssh(input) {
        let canonical = parsed.to_openssh(ssh_key::LineEnding::LF)?.to_string();
        return Ok((canonical, parsed));
    }

    // Try to fix seed-only Ed25519 keys and re-parse.
    fn try_fix_seed_only_ed25519(input: &str) -> Option<String> {
        // Minimal OpenSSH container parse to detect seed-only Ed25519
        const HEADER: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
        const FOOTER: &str = "-----END OPENSSH PRIVATE KEY-----";
        let (start, end) = match (input.find(HEADER), input.find(FOOTER)) {
            (Some(h), Some(f)) => (h + HEADER.len(), f),
            _ => return None,
        };
        let body = &input[start..end];
        let b64: String = body
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("");

        let raw = match base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()) {
            Ok(v) => v,
            Err(_) => return None,
        };

        let mut idx = 0usize;
        let magic = b"openssh-key-v1\0";
        if raw.len() < magic.len() || &raw[..magic.len()] != magic {
            return None;
        }
        idx += magic.len();

        fn read_u32(buf: &[u8], idx: &mut usize) -> Option<u32> {
            if *idx + 4 > buf.len() {
                return None;
            }
            let v = u32::from_be_bytes([buf[*idx], buf[*idx + 1], buf[*idx + 2], buf[*idx + 3]]);
            *idx += 4;
            Some(v)
        }
        fn read_string<'a>(buf: &'a [u8], idx: &mut usize) -> Option<&'a [u8]> {
            let n = read_u32(buf, idx)? as usize;
            if *idx + n > buf.len() {
                return None;
            }
            let s = &buf[*idx..*idx + n];
            *idx += n;
            Some(s)
        }

        let ciphername = read_string(&raw, &mut idx)?;
        let kdfname = read_string(&raw, &mut idx)?;
        let _kdfopts = read_string(&raw, &mut idx)?;
        if ciphername != b"none" || kdfname != b"none" {
            return None;
        }

        let nkeys = read_u32(&raw, &mut idx)? as usize;
        for _ in 0..nkeys {
            let _ = read_string(&raw, &mut idx)?;
        }
        let private_block = read_string(&raw, &mut idx)?;

        let mut pidx = 0usize;
        let check1 = read_u32(private_block, &mut pidx)?;
        let check2 = read_u32(private_block, &mut pidx)?;
        if check1 != check2 {
            return None;
        }

        let alg = read_string(private_block, &mut pidx)?;
        if alg != b"ssh-ed25519" {
            return None;
        }
        let _pubkey = read_string(private_block, &mut pidx)?;
        let privkey = read_string(private_block, &mut pidx)?;
        let comment_bytes = read_string(private_block, &mut pidx)?;

        // Build canonical keypair bytes
        let mut keypair_bytes = [0u8; 64];
        if privkey.len() == 32 {
            let seed: [u8; 32] = match privkey.try_into() {
                Ok(a) => a,
                Err(_) => return None,
            };
            let sk = ed25519_dalek::SigningKey::from_bytes(&seed);
            let vk = sk.verifying_key();
            let pub_bytes = vk.to_bytes();
            keypair_bytes[..32].copy_from_slice(&seed);
            keypair_bytes[32..].copy_from_slice(pub_bytes.as_ref());
        } else if privkey.len() == 64 {
            keypair_bytes.copy_from_slice(privkey);
        } else {
            return None;
        }
        let ed_kp = match Ed25519Keypair::from_bytes(&keypair_bytes) {
            Ok(k) => k,
            Err(_) => return None,
        };
        let comment = String::from_utf8(comment_bytes.to_vec()).unwrap_or_default();
        let key_data = KeypairData::from(ed_kp);
        let private = match ssh_key::PrivateKey::new(key_data, comment) {
            Ok(p) => p,
            Err(_) => return None,
        };
        match private.to_openssh(ssh_key::LineEnding::LF) {
            Ok(s) => Some(s.to_string()),
            Err(_) => None,
        }
    }

    let candidate = try_fix_seed_only_ed25519(input).unwrap_or_else(|| input.to_string());
    let parsed = russh::keys::PrivateKey::from_openssh(&candidate)?;
    let canonical = parsed.to_openssh(ssh_key::LineEnding::LF)?.to_string();
    Ok((canonical, parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_private_key_rejects_invalid_constant() {
        let invalid_key = "this is not a private key".to_string();
        let result = validate_private_key(invalid_key);
        assert!(result.is_err(), "Expected Err for invalid key content");
    }

    #[test]
    fn validate_private_key_accepts_1() {
        // Generated with: ssh-keygen -t ed25519 -C "test-ed25519@fressh.com" -f ./ed25519-with-comment
        let valid_key = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACC7PhmC0yS0Q8LcUkRnoYCxpb4gkCjJhadvvf+TDlRBJwAAAKCX5GEsl+Rh
LAAAAAtzc2gtZWQyNTUxOQAAACC7PhmC0yS0Q8LcUkRnoYCxpb4gkCjJhadvvf+TDlRBJw
AAAEBmrg8TL0+2xypHjVpFeuQmgQf3Qn/A45Jz+zCwVgoBt7s+GYLTJLRDwtxSRGehgLGl
viCQKMmFp2+9/5MOVEEnAAAAF3Rlc3QtZWQyNTUxOUBmcmVzc2guY29tAQIDBAUG
-----END OPENSSH PRIVATE KEY-----
"
        .to_string();
        let result = validate_private_key(valid_key);
        assert!(result.is_ok(), "Expected Ok for valid key content");
    }
    #[test]
    fn validate_private_key_accepts_2() {
        // Generated with: ssh-keygen -t ed25519 -f ./ed25519-wo-comment
        let valid_key = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACD/icJYduvcR9JPKw9g/bPWpsgS0IAaJxlYL5yeuOaNMgAAAJjDAt7NwwLe
zQAAAAtzc2gtZWQyNTUxOQAAACD/icJYduvcR9JPKw9g/bPWpsgS0IAaJxlYL5yeuOaNMg
AAAEDYE6BYf7QlpAaJCfaxA/HN487NM9iIF7VGue/iefZIyP+Jwlh269xH0k8rD2D9s9am
yBLQgBonGVgvnJ645o0yAAAADmV0aGFuQEV0aGFuLVBDAQIDBAUGBw==
-----END OPENSSH PRIVATE KEY-----
"
        .to_string();
        let result = validate_private_key(valid_key);
        assert!(result.is_ok(), "Expected Ok for valid key content");
    }
    #[test]
    fn validate_private_key_accepts_3() {
        // Generated with: ssh-keygen -t ed25519 -C "" -N "" -f ./ed25519-wo-comment-and-hostname
        let valid_key = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDt2ZcFrEhB8/B4uu30mPIi3BWWEa/wE//IUXLeL9YevAAAAIg90nGHPdJx
hwAAAAtzc2gtZWQyNTUxOQAAACDt2ZcFrEhB8/B4uu30mPIi3BWWEa/wE//IUXLeL9YevA
AAAEBMtZWpjpVnzDhYKR3V09SLohGqkW7HgMXoF8f0zf+/Pu3ZlwWsSEHz8Hi67fSY8iLc
FZYRr/AT/8hRct4v1h68AAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
"
        .to_string();
        let result = validate_private_key(valid_key);
        assert!(result.is_ok(), "Expected Ok for valid key content");
    }
    #[test]
    fn validate_private_key_accepts_4() {
        // Generated with juicessh
        let valid_key = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACCh5IbLI9ypdFzNW8WvezgBrzJT/2mT9BKSdZScB4EYoQAAAJB8YyoafGMqGgAAAAtzc2gtZWQyNTUxOQAAACCh5IbLI9ypdFzNW8WvezgBrzJT/2mT9BKSdZScB4EYoQAAAECpYzHTSiKC2iehjck1n8GAp5mdGuB2J5vV+9U3MAvthKHkhssj3Kl0XM1bxa97OAGvMlP/aZP0EpJ1lJwHgRihAAAAAAECAwQFBgcICQoLDA0=
-----END OPENSSH PRIVATE KEY-----
".to_string();
        let result = validate_private_key(valid_key);
        assert!(result.is_ok(), "Expected Ok for valid key content");
    }
}
