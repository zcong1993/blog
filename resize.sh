#!/bin/bash

resize_cli=${RESIZE_CLI:-resize-cli}
quality=${1:-70}

for ff in ./static/{,**/}*.png; do
  $resize_cli -input "$ff" -replace -quality "$quality"
done
