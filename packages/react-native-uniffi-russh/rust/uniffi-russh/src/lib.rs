//! This file is used to generate Typescript bindings for the Russh library.
//!
//! For more information on the available data types, see the following links:
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
//! - https://jhugman.github.io/uniffi-bindgen-react-native/idioms/async-callbacks.html

use std::collections::HashMap;
use std::fmt;
use std::sync::{atomic::{AtomicU64, AtomicUsize, Ordering}, Arc, Mutex, Weak};
use std::time::{SystemTime, UNIX_EPOCH, Duration};

use rand::rngs::OsRng;
use thiserror::Error;
use tokio::sync::{broadcast, Mutex as AsyncMutex};

use russh::{self, client, ChannelMsg, Disconnect};
use russh::client::{Config, Handle as ClientHandle};
use russh_keys::{Algorithm, EcdsaCurve};
use russh::keys::PrivateKeyWithHashAlg;
use russh_keys::ssh_key::{self, LineEnding};
// Alias the internal ssh_key re-export used by russh for type compatibility
use russh::keys::ssh_key as russh_ssh_key;
use russh_keys::ssh_key::{private::{Ed25519Keypair, KeypairData}};
use bytes::Bytes;
use base64::Engine as _;
use ed25519_dalek::SigningKey;

uniffi::setup_scaffolding!();

