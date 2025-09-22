//! This file is used to generate Typescript bindings for the Russh library.
//!
//! For more information on the available data types, see the following links:
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/async-callbacks.html

pub mod private_key;
pub mod ssh_connection;
pub mod ssh_shell;
pub mod utils;

uniffi::setup_scaffolding!();
