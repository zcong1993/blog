#!/bin/bash

resize_cli=${RESIZE_CLI:-resize-cli}
quality=${1:-70}

for ff in ./images/{,**/}*.png; do
  out=${ff//images/static}
  $resize_cli -input "$ff" -output "$out" -quality "$quality" -force
done
