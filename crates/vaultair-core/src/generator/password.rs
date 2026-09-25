//! Random character passwords.

use serde::Deserialize;
use zeroize::Zeroizing;

use super::random::{self, Uniform};
use super::{rng_err, strength, Generated};
use crate::crypto::CryptoResult;
use crate::AppError;

pub const MIN_LENGTH: u16 = 8;
pub const MAX_LENGTH: u16 = 128;
pub const DEFAULT_LENGTH: u16 = 20;
/// Longest custom exclusion list accepted; more than every character we use.
pub const MAX_EXCLUDE_CHARS: usize = 128;

const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const DIGITS: &str = "0123456789";
/// ASCII punctuation minus the characters that break when pasted into forms,
/// shells or config files: quotes, backtick, backslash, pipe and space.
pub const SYMBOLS: &str = "!#$%&()*+,-./:;<=>?@[]^_{}~";
/// Removed by "exclude ambiguous": easy to misread in many fonts.
pub const AMBIGUOUS: &str = "Il1O0o";

/// Redraws allowed before giving up. Even the tightest valid options
/// (length 8, four classes, some cut to one character) succeed within a few
/// hundred draws; hitting this means something is wrong, not unlucky.
const MAX_ATTEMPTS: u32 = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PasswordOptions {
    /// 8–128 characters.
    pub length: u16,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    /// Leaves out `Il1O0o`.
    pub exclude_ambiguous: bool,
    /// Extra characters to leave out. Characters we never use are ignored.
    pub exclude: String,
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            length: DEFAULT_LENGTH,
            uppercase: true,
            lowercase: true,
            digits: true,
            symbols: true,
            exclude_ambiguous: false,
            exclude: String::new(),
        }
    }
}

impl PasswordOptions {
    /// The selected classes after exclusions, each guaranteed non-empty.
    fn classes(&self) -> Result<Vec<Vec<char>>, AppError> {
        if !(MIN_LENGTH..=MAX_LENGTH).contains(&self.length) {
            return Err(AppError::InvalidInput { field: "length" });
        }
        if self.exclude.chars().count() > MAX_EXCLUDE_CHARS {
            return Err(AppError::InvalidInput { field: "exclude" });
        }
        let excluded = |c: &char| {
            (self.exclude_ambiguous && AMBIGUOUS.contains(*c)) || self.exclude.contains(*c)
        };
        let classes: Vec<Vec<char>> = [
            (self.uppercase, UPPER),
            (self.lowercase, LOWER),
            (self.digits, DIGITS),
            (self.symbols, SYMBOLS),
        ]
        .into_iter()
        .filter(|(on, _)| *on)
        .map(|(_, set)| set.chars().filter(|c| !excluded(c)).collect())
        .collect();
        if classes.is_empty() {
            return Err(AppError::InvalidInput { field: "classes" });
        }
        if classes.iter().any(Vec::is_empty) {
            return Err(AppError::InvalidInput { field: "exclude" });
        }
        Ok(classes)
    }
}

pub fn generate_password(options: &PasswordOptions) -> Result<Generated, AppError> {
    let classes = options.classes()?;
    let value = draw(&classes, usize::from(options.length), &mut random::os())
        .map_err(rng_err)?
        .ok_or(AppError::Internal {
            context: "generator",
        })?;
    let sizes: Vec<usize> = classes.iter().map(Vec::len).collect();
    Ok(Generated {
        entropy_bits: strength::password_entropy_bits(&sizes, value.len()),
        score: strength::score(&value),
        value: String::clone(&value),
    })
}

/// Draws `length` characters uniformly from the union of `classes`, redrawing
/// the whole password until every class appears. Returns `None` if that
/// never happens within `MAX_ATTEMPTS`.
fn draw<S: FnMut(&mut [u8]) -> CryptoResult<()>>(
    classes: &[Vec<char>],
    length: usize,
    uniform: &mut Uniform<S>,
) -> CryptoResult<Option<Zeroizing<String>>> {
    let alphabet: Vec<(char, u8)> = classes
        .iter()
        .zip(0u8..)
        .flat_map(|(class, i)| class.iter().map(move |&c| (c, i)))
        .collect();
    let all_classes = (1u32 << classes.len()) - 1;
    let mut value = Zeroizing::new(String::with_capacity(length));
    for _ in 0..MAX_ATTEMPTS {
        value.clear();
        let mut seen = 0u32;
        for _ in 0..length {
            let &(c, class) = uniform.pick(&alphabet)?;
            value.push(c);
            seen |= 1 << class;
        }
        if seen == all_classes {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    fn options() -> impl Strategy<Value = PasswordOptions> {
        (
            MIN_LENGTH..=MAX_LENGTH,
            any::<[bool; 4]>().prop_filter("at least one class", |c| c.iter().any(|&on| on)),
            any::<bool>(),
            prop::sample::subsequence(
                format!("{UPPER}{LOWER}{DIGITS}{SYMBOLS}")
                    .chars()
                    .collect::<Vec<_>>(),
                0..12,
            ),
        )
            .prop_map(
                |(length, [u, l, d, s], ambiguous, exclude)| PasswordOptions {
                    length,
                    uppercase: u,
                    lowercase: l,
                    digits: d,
                    symbols: s,
                    exclude_ambiguous: ambiguous,
                    exclude: exclude.into_iter().collect(),
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(512))]

        #[test]
        fn output_always_satisfies_the_options(opts in options()) {
            let result = generate_password(&opts);
            let classes = [
                (opts.uppercase, UPPER),
                (opts.lowercase, LOWER),
                (opts.digits, DIGITS),
                (opts.symbols, SYMBOLS),
            ];
            let excluded = |c: char| (opts.exclude_ambiguous && AMBIGUOUS.contains(c)) || opts.exclude.contains(c);
            let emptied = classes.iter().any(|(on, set)| *on && set.chars().all(excluded));
            if emptied {
                prop_assert_eq!(result, Err(AppError::InvalidInput { field: "exclude" }));
                return Ok(());
            }
            let generated = result.unwrap();
            let value = &generated.value;
            prop_assert_eq!(value.chars().count(), usize::from(opts.length));
            for c in value.chars() {
                prop_assert!(!excluded(c), "excluded {c:?} in output");
                prop_assert!(classes.iter().any(|(on, set)| *on && set.contains(c)), "unselected {c:?}");
            }
            for (on, set) in classes {
                if on {
                    prop_assert!(value.chars().any(|c| set.contains(c)), "missing a class from {set}");
                }
            }
            prop_assert!(generated.entropy_bits > 0.0);
            prop_assert!(generated.score <= 4);
        }
    }

    #[test]
    fn default_options_are_strong() {
        let g = generate_password(&PasswordOptions::default()).unwrap();
        assert_eq!(g.value.len(), 20);
        assert!(g.entropy_bits > 125.0, "{}", g.entropy_bits);
    }

    #[test]
    fn rejects_bad_lengths() {
        for length in [0, 7, 129, 1000] {
            let opts = PasswordOptions {
                length,
                ..PasswordOptions::default()
            };
            assert_eq!(
                generate_password(&opts),
                Err(AppError::InvalidInput { field: "length" })
            );
        }
        for length in [8, 128] {
            let opts = PasswordOptions {
                length,
                ..PasswordOptions::default()
            };
            assert!(generate_password(&opts).is_ok());
        }
    }

    #[test]
    fn rejects_no_classes() {
        let opts = PasswordOptions {
            uppercase: false,
            lowercase: false,
            digits: false,
            symbols: false,
            ..PasswordOptions::default()
        };
        assert_eq!(
            generate_password(&opts),
            Err(AppError::InvalidInput { field: "classes" })
        );
    }

    #[test]
    fn rejects_excluding_a_whole_class() {
        let opts = PasswordOptions {
            exclude: DIGITS.into(),
            ..PasswordOptions::default()
        };
        assert_eq!(
            generate_password(&opts),
            Err(AppError::InvalidInput { field: "exclude" })
        );
        // Fine once digits are off.
        let opts = PasswordOptions {
            digits: false,
            ..opts
        };
        assert!(generate_password(&opts).is_ok());
    }

    #[test]
    fn rejects_huge_exclusion_lists() {
        let opts = PasswordOptions {
            exclude: "x".repeat(MAX_EXCLUDE_CHARS + 1),
            ..PasswordOptions::default()
        };
        assert_eq!(
            generate_password(&opts),
            Err(AppError::InvalidInput { field: "exclude" })
        );
    }

    #[test]
    fn entropy_reflects_exclusions() {
        let plain = generate_password(&PasswordOptions::default()).unwrap();
        let fewer = generate_password(&PasswordOptions {
            exclude_ambiguous: true,
            ..PasswordOptions::default()
        })
        .unwrap();
        assert!(fewer.entropy_bits < plain.entropy_bits);
    }

    #[test]
    fn gives_up_instead_of_looping_forever() {
        // A source that only ever yields index 0 can never produce a second class.
        let mut stuck = Uniform::new(|buf: &mut [u8]| {
            buf.fill(0);
            Ok(())
        });
        let classes = vec![vec!['a', 'b'], vec!['1']];
        assert_eq!(draw(&classes, 8, &mut stuck).unwrap(), None);
    }

    #[test]
    fn debug_redacts_the_value() {
        let g = generate_password(&PasswordOptions::default()).unwrap();
        assert!(!format!("{g:?}").contains(&g.value));
    }

    /// Loose uniformity check over 20 000 default passwords. Requiring every
    /// class slightly favors the smaller classes (a password with no digit is
    /// redrawn), so the check is within each class: given its class, every
    /// character must be equally likely. Slow in debug builds; run with
    /// `cargo test -- --ignored`.
    #[test]
    #[ignore = "long statistical run"]
    fn characters_are_uniform_within_each_class() {
        let opts = PasswordOptions::default();
        let mut counts = std::collections::HashMap::<char, u64>::new();
        for _ in 0..20_000 {
            for c in generate_password(&opts).unwrap().value.chars() {
                *counts.entry(c).or_default() += 1;
            }
        }
        let mut chi2 = 0.0;
        for set in [UPPER, LOWER, DIGITS, SYMBOLS] {
            let observed: Vec<f64> = set
                .chars()
                .map(|c| counts.get(&c).copied().unwrap_or(0) as f64)
                .collect();
            let expected = observed.iter().sum::<f64>() / observed.len() as f64;
            chi2 += observed
                .iter()
                .map(|o| (o - expected).powi(2) / expected)
                .sum::<f64>();
        }
        // 25 + 25 + 9 + 26 = 85 degrees of freedom: the 99.9th percentile is about 133.
        assert!(chi2 < 150.0, "chi-square {chi2}");
    }
}
