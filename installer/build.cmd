@echo off
rem Builds LumicordInstaller.exe with the C# compiler that ships with Windows. Bundles src/, plugins/, themes/, vencord/.
cd /d "%~dp0.."
set RES=
for %%f in (version.json src\*.js plugins\*.js themes\*.css vencord\*.js vencord\*.css vencord\*.txt vencord\LICENSE) do call set RES=%%RES%% /resource:"%%f",files/%%f
set RES=%RES:\=/%
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize /out:LumicordInstaller.exe /win32icon:installer\icon.ico /resource:installer\icon.png,logo.png %RES% installer\Installer.cs
