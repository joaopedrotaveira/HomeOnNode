#!/bin/sh

check_exit_code() {
  if [ "${1}" -eq "0" ]; then
    echo "Normal exit."
  elif [ "${1}" -eq "10" ]; then
    echo "Reboot requested."
    sudo reboot
  else
    echo "Unknown exit code: ${1}"
    echo "${1}" >> exitcodes.txt
  fi
}

echo Resetting any local file changes...
git reset --hard

echo Getting latest version...
git pull

echo Updating any node modules...
npm install

echo Exporting pin 23 and pulling up
gpio-admin export 23 pullup

echo Starting app...
node app.js

check_exit_code $?