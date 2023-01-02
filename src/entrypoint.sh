#!/bin/bash

echo "Loading user's custom files from /docker-entrypoint.d";
if [[ -n $(find /docker-entrypoint.d/ -type f -regex ".*\.\(sh\)") ]]; then
  for f in /docker-entrypoint.d/*; do
    case "$f" in
      *.sh)
        if [[ -x "$f" ]]; then
          echo "Executing $f";
          if ! "$f"; then
            echo "Failed executing $f"
            exit 1
          fi
        else
          echo "Sourcing $f as it is not executable by the current user, any error may cause initialization to fail"
          . "$f"
        fi
        ;;
      *)
        echo "Skipping $f, supported formats are: .sh"
        ;;
    esac
  done
fi

exec "$@"
