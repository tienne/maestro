use std::collections::HashMap;
use std::process::{Child, ChildStdin};
use std::sync::{Arc, Mutex};
use rusqlite::Connection;

pub struct DbState(pub Arc<Mutex<Connection>>);

/// stdin handles separated from Child so exit-monitoring thread
/// can call child.wait() without blocking stdin writes.
#[derive(Default)]
pub struct ProcessRegistry {
    pub children: HashMap<String, Child>,
    pub stdins: HashMap<String, ChildStdin>,
}

pub struct ProcessState(pub Arc<Mutex<ProcessRegistry>>);
