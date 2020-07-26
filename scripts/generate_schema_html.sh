#!/bin/bash
cd "${0%/*}"
# Requires python package json-schema-for-humans: https://github.com/coveooss/json-schema-for-humans
# Install using "pip install json-schema-for-humans"
generate-schema-doc --minify --no-link-to-reused-ref --expand-buttons ../config/config_schema.json ../docs/config_schema.html
