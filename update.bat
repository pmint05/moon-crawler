@echo off

:: Define URLs for each file
set "urlIndexJs=https://raw.githubusercontent.com/pmint05/moon-crawler/main/bin/index.js"
set "urlPackageJson=https://raw.githubusercontent.com/pmint05/moon-crawler/main/bin/package.json"
set "urlPackageLockJson=https://raw.githubusercontent.com/pmint05/moon-crawler/main/bin/package-lock.json"
set "urlEditConfigBat=https://raw.githubusercontent.com/pmint05/moon-crawler/main/edit_config.bat"
set "urlConfigExampleJson=https://raw.githubusercontent.com/pmint05/moon-crawler/main/config.example.json"
set "urlReadmeTxt=https://raw.githubusercontent.com/pmint05/moon-crawler/main/readme.txt"
set "urlReadmeMd=https://raw.githubusercontent.com/pmint05/moon-crawler/main/readme.md"

:: Define output paths
set "outputPathIndexJs=bin\index.js"
set "outputPathPackageJson=bin\package.json"
set "outputPathPackageLockJson=bin\package-lock.json"
set "outputPathEditConfigBat=edit_config.bat"
set "outputPathConfigExampleJson=config.example.json"
set "outputPathReadmeTxt=readme.txt"
set "outputPathReadmeMd=readme.md"

:: Fetch and save each file
echo Fetching content from %urlIndexJs%...
curl -k %urlIndexJs% -o "%outputPathIndexJs%"
echo Content saved to %outputPathIndexJs%.

echo Fetching content from %urlPackageJson%...
curl -k %urlPackageJson% -o "%outputPathPackageJson%"
echo Content saved to %outputPathPackageJson%.

echo Fetching content from %urlPackageLockJson%...
curl -k %urlPackageLockJson% -o "%outputPathPackageLockJson%"
echo Content saved to %outputPathPackageLockJson%.

echo Fetching content from %urlEditConfigBat%...
curl -k %urlEditConfigBat% -o "%outputPathEditConfigBat%"
echo Content saved to %outputPathEditConfigBat%.

echo Fetching content from %urlConfigExampleJson%...
curl -k %urlConfigExampleJson% -o "%outputPathConfigExampleJson%"
echo Content saved to %outputPathConfigExampleJson%.

echo Fetching content from %urlReadmeTxt%...
curl -k %urlReadmeTxt% -o "%outputPathReadmeTxt%"
echo Content saved to %outputPathReadmeTxt%.

echo Fetching content from %urlReadmeMd%...
curl -k %urlReadmeMd% -o "%outputPathReadmeMd%"
echo Content saved to %outputPathReadmeMd%.

pause