use crate::BtcError;

// zpub version bytes → xpub version bytes
const ZPUB_VERSION: [u8; 4] = [0x04, 0xb2, 0x47, 0x46];
const XPUB_VERSION: [u8; 4] = [0x04, 0x88, 0xb2, 0x1e];

/// Convert a zpub into a wpkh descriptor.
/// Input: `zpub...` or already `xpub...`
/// Output: `wpkh(xpub.../0/*)`
fn get_xpub_from_zpub_or_xpub(zpub: &str) -> Result<String, BtcError> {
    if zpub.starts_with("zpub") {
        convert_zpub_to_xpub(zpub)
    } else if zpub.starts_with("xpub") {
        Ok(zpub.to_string())
    } else {
        Err(BtcError::InvalidDescriptor(
            format!("expected zpub or xpub, got: {}", &zpub[..4.min(zpub.len())])
        ))
    }
}

pub fn zpub_to_descriptor(zpub: &str) -> Result<String, BtcError> {
    let xpub = get_xpub_from_zpub_or_xpub(zpub)?;
    Ok(format!("wpkh({}/0/*)", xpub))
}

pub fn zpub_to_change_descriptor(zpub: &str) -> Result<String, BtcError> {
    let xpub = get_xpub_from_zpub_or_xpub(zpub)?;
    Ok(format!("wpkh({}/1/*)", xpub))
}

fn convert_zpub_to_xpub(zpub: &str) -> Result<String, BtcError> {
    let decoded = bs58_decode_check(zpub)
        .map_err(|e| BtcError::InvalidDescriptor(format!("zpub decode: {e}")))?;

    if decoded.len() != 78 {
        return Err(BtcError::InvalidDescriptor(
            format!("unexpected zpub length: {}", decoded.len())
        ));
    }
    if decoded[..4] != ZPUB_VERSION {
        return Err(BtcError::InvalidDescriptor(
            format!("not a zpub (version bytes: {:02x}{:02x}{:02x}{:02x})",
                decoded[0], decoded[1], decoded[2], decoded[3])
        ));
    }

    let mut xpub_bytes = decoded;
    xpub_bytes[..4].copy_from_slice(&XPUB_VERSION);
    Ok(bs58_encode_check(&xpub_bytes))
}

// Base58Check

fn bs58_decode_check(s: &str) -> Result<Vec<u8>, String> {
    let mut decoded = bs58_decode(s)?;
    if decoded.len() < 4 {
        return Err("too short".into());
    }
    let payload_len = decoded.len() - 4;
    let checksum = &decoded[payload_len..].to_vec();
    let payload = &decoded[..payload_len];
    let expected = &double_sha256(payload)[..4];
    if checksum != expected {
        return Err("checksum mismatch".into());
    }
    decoded.truncate(payload_len);
    Ok(decoded)
}

fn bs58_encode_check(payload: &[u8]) -> String {
    let checksum = double_sha256(payload);
    let mut data = payload.to_vec();
    data.extend_from_slice(&checksum[..4]);
    bs58_encode(&data)
}

fn double_sha256(data: &[u8]) -> [u8; 32] {
    use bitcoin::hashes::{sha256, Hash};
    let first = sha256::Hash::hash(data);
    let second = sha256::Hash::hash(first.as_ref());
    second.to_byte_array()
}

const BASE58_ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn bs58_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut result = vec![0u8];
    for c in s.bytes() {
        let digit = BASE58_ALPHABET.iter().position(|&b| b == c)
            .ok_or_else(|| format!("invalid base58 char: {}", c as char))? as u32;
        let mut carry = digit;
        for byte in result.iter_mut().rev() {
            carry += 58 * (*byte as u32);
            *byte = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            result.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    // leading '1's → leading 0x00 bytes
    let leading_zeros = s.bytes().take_while(|&b| b == b'1').count();
    let mut out = vec![0u8; leading_zeros];
    out.extend_from_slice(&result);
    Ok(out)
}

fn bs58_encode(data: &[u8]) -> String {
    let mut result = Vec::new();
    let mut num = data.to_vec();
    while !num.is_empty() && num != [0] {
        let mut remainder = 0u32;
        let mut new_num = Vec::new();
        for &byte in &num {
            let cur = remainder * 256 + byte as u32;
            if !new_num.is_empty() || cur / 58 > 0 {
                new_num.push((cur / 58) as u8);
            }
            remainder = cur % 58;
        }
        result.push(BASE58_ALPHABET[remainder as usize]);
        num = new_num;
    }
    let leading_zeros = data.iter().take_while(|&&b| b == 0).count();
    let mut out = String::new();
    for _ in 0..leading_zeros {
        out.push('1');
    }
    for &b in result.iter().rev() {
        out.push(b as char);
    }
    out
}
