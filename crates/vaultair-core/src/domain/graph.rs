//! The relationship map: what a focus is connected to. Nodes name records and
//! edges name how they relate. Nothing here carries a password, a secret, a
//! fingerprint or a strength score.

use serde::{Deserialize, Serialize};

use crate::domain::account::text_enum;
use crate::domain::identity::IdentityColor;

text_enum!(
    /// What the map can be centred on. A contact is an email or a phone.
    FocusKind {
        Identity => "identity",
        Account => "account",
        Contact => "contact",
        Platform => "platform",
        Game => "game",
    }
);

/// The record the map is drawn around.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GraphFocus {
    pub kind: FocusKind,
    pub id: String,
}

text_enum!(
    /// What a node stands for. A recovery method is a phone (a recovery
    /// email is an email node with a recovery edge).
    NodeKind {
        Identity => "identity",
        Email => "email",
        RecoveryMethod => "recovery_method",
        Account => "account",
        Platform => "platform",
        Game => "game",
        MfaMethod => "mfa_method",
    }
);

text_enum!(
    /// How two nodes relate. Edges run from what is depended on to what
    /// depends on it: identity, then contact, then account, then what the
    /// account uses.
    EdgeKind {
        // Identity to an account assigned to it.
        Owns => "owns",
        // Identity to its primary email.
        PrimaryEmail => "primary_email",
        // Identity to its recovery email, or an email to an account that
        // recovers through it.
        RecoveryEmail => "recovery_email",
        // Identity to its phone.
        Phone => "phone",
        // Email to an account that signs in with it.
        LoginEmail => "login_email",
        // Phone to an account that recovers through it.
        RecoveryPhone => "recovery_phone",
        // Launcher account to an account whose game profile links it.
        LinkedLauncher => "linked_launcher",
        // Console account to an account whose game profile links it.
        LinkedConsole => "linked_console",
        // Account to its platform.
        OnPlatform => "on_platform",
        // Account to a game it is for, or has a profile in.
        Plays => "plays",
        // Account to an MFA method that is turned on.
        Mfa => "mfa",
    }
);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// `<kind>:<id>`, unique in the graph.
    pub id: String,
    pub kind: NodeKind,
    /// The record a click opens: the identity, the account (for an account
    /// and for its MFA method), or the contact, platform or game to refocus on.
    pub record_id: String,
    pub label: String,
    /// An account's purpose name.
    pub detail: Option<String>,
    /// A catalog icon slug: the platform's or game's own, or an account's mark.
    pub icon: Option<String>,
    pub color: Option<IdentityColor>,
    /// Steps from the focus (0 is the focus).
    pub depth: u8,
    /// The node this one hangs under in the tree view; `None` for the focus.
    pub parent: Option<String>,
    /// How it relates to `parent`.
    pub parent_edge: Option<EdgeKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: EdgeKind,
}

/// A focus and everything within `depth` steps of it, capped at `limit` nodes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    /// The focus node's id.
    pub focus: String,
    /// Nearest first, then by kind and label.
    pub nodes: Vec<GraphNode>,
    /// Every relationship between two of `nodes`.
    pub edges: Vec<GraphEdge>,
    /// More was in reach than `limit` allowed. Narrow the focus to see it.
    pub truncated: bool,
}
