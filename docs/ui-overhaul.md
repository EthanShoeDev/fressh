Right now the styling for my app is very bad. @apps/mobile/src/app/\_layout.tsx
@apps/mobile/src/app/index.tsx @apps/mobile/src/app/ shell.tsx First off, on IOS
if I do not use the SafeAreaView, the app header title renders underneath the
notch. https:// docs.expo.dev/develop/user-interface/safe-areas/ and underneath
the system bars https://docs.expo.dev/develop/user-interface/system- bars/ I
tried to implement it but I am not sure if the safearea should go above the
scrollview or below? I see no examples of using safe area with a scroll view in
the docs. Right now if I like over drage in either direction, there is a white
background around everything. EI my chosen background color is not edge to edge
when overscrolling. I was kind of hoping to use liquid glass like described the
images show in this guide https://docs.expo.dev/router/advanced/native-tabs/ but
the ones that show up on my ios simulator are not liquid glass. Maybe I need an
ios simulator with a different IOS version? (mine is 18) maybe I need to enable
it somewhere? https://docs.expo.dev/versions/latest/sdk/glass-effect/ Also I
eventually want users to pick their own theme. That will live in the settings
page but all the colors should come from a single theme file (currently doesn't
exist). Also when I did the layout for the index screen, I was not planning on
having a bottom tab bar, now that I do it should probably change. I really hate
everything about the private key modal, I would rather it be its own shared
route https://docs.expo.dev/router/advanced/shared- routes/ or maybe it should
be a modal? https://docs.expo.dev/router/advanced/modals/? not sure but I know I
want to be able to bring up the same private key management Ui from the settings
screen and the index screen. I imagine they should be pushed to the top of the
stack of whatever bottom tab you are currently on. We will also need the shell
screen to start out on a list shell screen. The shell detail (what is currently
shell.tsx) will need to be renamed and moved. The placeholder text in the
command input box is truncated on the shell screen. I do not think we should put
the execute button on the same line as the command input text. It makes the
command input textbox too small. We also need to add a disconnect button to the
screen for ios users because they do not have a back button. (Maybe we do this
in the header bar?)
https://docs.expo.dev/router/advanced/stack/#configure-header-bar
