@echo off
set "url=https://raw.githubusercontent.com/pmint05/moon-crawler/main/bin/index.js"
set "outputPath=bin\index.js"

echo Fetching content from %url%...
curl -k %url% -o "%outputPath%"

echo Content saved to %outputPath%.
pause