# Designer Terminal shell integration. The user's own ~/.zshrc runs first, untouched.
DT_DIR=$ZDOTDIR
ZDOTDIR=$HOME   # so ~/.zlogin and anything reading $ZDOTDIR behaves as usual
# macOS's /etc/zshrc already put history in $ZDOTDIR (our folder, inside the app). Use the normal one.
[[ $HISTFILE == $DT_DIR/* ]] && HISTFILE=$HOME/.zsh_history
[[ -f ~/.zshrc ]] && source ~/.zshrc

# --- Tell the app where we are and how the last command went ----------------
# OSC 7 = current folder (sidebar + breadcrumb follow `cd`).
# OSC 133 C = a command started (app goes "busy"), D;<code> = it finished.
__dt_ran=0
__dt_preexec() { __dt_ran=1; printf '\e]133;C\a'; }
__dt_precmd() {
  local code=$?
  (( __dt_ran )) && printf '\e]133;D;%s\a' $code
  __dt_ran=0
  printf '\e]7;file://%s%s\a' "$HOST" "$PWD"
}
preexec_functions=(__dt_preexec $preexec_functions)
precmd_functions=(__dt_precmd $precmd_functions)

# The inverse "%" zsh prints for unterminated output reads as garbage to newcomers, and
# shows up spuriously when a pane is resized right after it opens.
unsetopt PROMPT_SP

# --- Safety -----------------------------------------------------------------
# rm moves to the Trash instead of deleting forever. `command rm` still deletes for real.
rm() {
  local files=() arg
  for arg in "$@"; do [[ $arg == -* ]] || files+=("$arg"); done
  (( ${#files} )) || { print "Nothing to delete. Usage: rm <file or folder>"; return 1; }
  command trash -s "${files[@]}" && print -P "%F{8}Moved to Trash - open the Trash in Finder to get it back.%f"
}

# Commands that can't be undone ask first. ponytail: short regex list, grow it from real mistakes.
__dt_dangerous='(^|[;&|][[:space:]]*)(sudo[[:space:]]|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+push[[:space:]].*(-f|--force)|git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f|git[[:space:]]+checkout[[:space:]]+\.|command[[:space:]]+rm[[:space:]])'
__dt_accept_line() {
  if [[ $BUFFER =~ $__dt_dangerous ]]; then
    local key
    zle -M "Heads up: this can't be undone. Press y to run it, any other key to cancel."
    read -k 1 key
    if [[ $key != [yY] ]]; then
      BUFFER=
      zle -M "Cancelled - nothing happened."
      return
    fi
  fi
  zle .accept-line
}
zle -N accept-line __dt_accept_line
