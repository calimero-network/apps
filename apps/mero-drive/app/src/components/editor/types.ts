// Editor status shared between EditorShell (producer — drives the UI
// state machine in Phase 8's DocumentEditor) and EditorStatusBar
// (consumer — renders the dot + label). Lives in a tiny shared file
// so the status bar doesn't need to import the shell.

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
