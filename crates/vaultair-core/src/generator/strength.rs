//! How strong a generated value is: exact entropy from how it was generated,
//! plus the zxcvbn score for a familiar 0–4 scale.
//!
//! Entropy is the honest number here: it counts the values the generator
//! could have produced. zxcvbn only sees the output and only its first 100
//! characters, so it's shown alongside, never instead.

/// Entropy in bits of a uniform password of `length` characters drawn from
/// disjoint classes of the given sizes, where every class must appear at
/// least once (the rejection sampling in `password.rs` makes the output
/// uniform over exactly that set).
///
/// The count of valid strings comes from inclusion–exclusion over the classes
/// that are missing: `Σ_S (-1)^|S| (N - |S|)^L`. It's computed as a ratio
/// against `N^L` so nothing overflows at length 128.
pub fn password_entropy_bits(class_sizes: &[usize], length: usize) -> f64 {
    let total: usize = class_sizes.iter().sum();
    if total == 0 || length == 0 {
        return 0.0;
    }
    let n = total as f64;
    let len = i32::try_from(length).unwrap_or(i32::MAX);
    let mut valid_fraction = 0.0;
    for mask in 0u32..(1 << class_sizes.len()) {
        let missing: usize = class_sizes
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, size)| size)
            .sum();
        let sign = if mask.count_ones() % 2 == 0 {
            1.0
        } else {
            -1.0
        };
        valid_fraction += sign * ((n - missing as f64) / n).powi(len);
    }
    f64::from(len) * n.log2() + valid_fraction.log2()
}

/// Entropy in bits of a passphrase of `words` words drawn uniformly from a
/// list of `list_len`, optionally with one random digit appended to one
/// randomly chosen word. Capitalization and the separator are fixed, so they
/// add nothing.
pub fn passphrase_entropy_bits(words: usize, list_len: usize, with_number: bool) -> f64 {
    let base = words as f64 * (list_len as f64).log2();
    if with_number {
        base + (10.0 * words as f64).log2()
    } else {
        base
    }
}

/// zxcvbn score, 0 (trivial) to 4 (very strong).
pub fn score(value: &str) -> u8 {
    u8::from(zxcvbn::zxcvbn(value, &[]).score())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn single_class_is_length_times_log2() {
        assert!(close(password_entropy_bits(&[26], 20), 20.0 * 26f64.log2()));
    }

    #[test]
    fn two_singleton_classes_of_length_two() {
        // Only "ab" and "ba" qualify: exactly 1 bit.
        assert!(close(password_entropy_bits(&[1, 1], 2), 1.0));
    }

    /// Brute force: enumerate every string and count those containing all classes.
    fn brute_force_bits(class_sizes: &[usize], length: usize) -> f64 {
        let total: usize = class_sizes.iter().sum();
        let class_of: Vec<usize> = class_sizes
            .iter()
            .enumerate()
            .flat_map(|(class, &size)| std::iter::repeat_n(class, size))
            .collect();
        let mut valid = 0u64;
        for mut code in 0..total.pow(u32::try_from(length).unwrap()) {
            let mut seen = 0u32;
            for _ in 0..length {
                seen |= 1 << class_of[code % total];
                code /= total;
            }
            if seen.count_ones() as usize == class_sizes.len() {
                valid += 1;
            }
        }
        (valid as f64).log2()
    }

    #[test]
    fn matches_brute_force_on_small_alphabets() {
        for (sizes, len) in [
            (&[2, 3][..], 4),
            (&[1, 2, 3], 5),
            (&[3, 1, 1, 2], 6),
            (&[4, 4], 3),
        ] {
            let exact = brute_force_bits(sizes, len);
            let computed = password_entropy_bits(sizes, len);
            assert!(
                (exact - computed).abs() < 1e-6,
                "{sizes:?} len {len}: {exact} vs {computed}"
            );
        }
    }

    #[test]
    fn requiring_classes_costs_a_little_entropy() {
        let free = 20.0 * 88f64.log2();
        let constrained = password_entropy_bits(&[26, 26, 10, 26], 20);
        assert!(constrained < free);
        assert!(free - constrained < 1.0, "{free} vs {constrained}");
    }

    #[test]
    fn long_passwords_stay_finite() {
        let bits = password_entropy_bits(&[26, 26, 10, 26], 128);
        assert!(bits.is_finite());
        assert!((bits - 128.0 * 88f64.log2()).abs() < 1e-6);
    }

    #[test]
    fn passphrase_entropy() {
        assert!(close(
            passphrase_entropy_bits(5, 7776, false),
            5.0 * 7776f64.log2()
        ));
        assert!(close(
            passphrase_entropy_bits(4, 7776, true),
            4.0 * 7776f64.log2() + 40f64.log2()
        ));
    }

    #[test]
    fn score_is_in_range() {
        assert!(score("password") <= 1);
        assert_eq!(score("vK7#pQ2!mZ9$wR4@tY6^"), 4);
    }
}
