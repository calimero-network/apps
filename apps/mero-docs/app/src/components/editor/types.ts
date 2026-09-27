// Save status shared by EditorShell (producer) and EditorStatusBar (consumer);
// its own file so the status bar never has to import the shell.

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'offline';
