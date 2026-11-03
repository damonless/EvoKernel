# VHS tape recording for EvoKernel Live Demo
Output demo.gif

Set FontSize 16
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 24

Type "npx evo-kernel score"
Sleep 500ms
Enter

Sleep 3s

Type "npx evo-kernel ui --export ./cockpit.html"
Sleep 500ms
Enter

Sleep 2s

Type "head -n 15 ./cockpit.html"
Sleep 500ms
Enter

Sleep 2s
