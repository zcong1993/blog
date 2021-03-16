#!/bin/bash

PREFIX="post/"
EXT=".md"

date=$(date '+%Y-%m-%d')

check_null() {
  if [ -z "$1" ]; then
    echo $2
    exit 1
  fi
}

hugo_new() {
  name=$1
  check_null $name 'post name is required!'

  POST_NAME="$date-$name"

  ALL_NAME="$PREFIX$POST_NAME$EXT"
  echo "create $ALL_NAME"

  hugo new $ALL_NAME
}

hugo_new "$@"
