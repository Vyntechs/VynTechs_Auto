### shell-quote-markdown
Trigger: Passing Markdown with backticks through a shell command.
Rule: Single-quote the complete argument and escape embedded apostrophes before invoking the shell.
Reason: Double-quoted backticks execute command substitution and silently corrupt external text.
