'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {BaseComputerUse,NativeConnection,baseDefinition,SCREENSHOT_DESCRIPTION,TASK_CONTINUITY_DESCRIPTION,validate,KEYS} = require('./base-computer-use.cjs');

// Native helper selection and the Windows-only platform check belong here.
const definition=JSON.parse(JSON.stringify(baseDefinition));
definition.title='Windows computer use';
definition.description='Windows computer use. Authorization is configured at service startup: default all_windows permits list_windows and open_session with a returned window_id (omitted means foreground window); per_window requires the local picker for each new session. open_session immediately returns session_id and state initializing or awaiting_consent; poll get_session without an ID until ready. Repeating open_session recovers the current ID without replaying input. close_session without an ID closes the current session. observe requires session_id and returns observation_id with an image or chunk manifest. Inputs require a fresh observation and unchanged foreground target/geometry; mouse_move and mouse_down use window-relative physical pixels. drag_window atomically moves, presses, visibly drags and releases from a fresh title-bar observation; before pressing it checks up to three candidate points, reports bounded occlusion metadata and never blindly replays uncertain input. Legacy mouse_drag uses screen_x/screen_y while left is held; mouse_up releases without a fresh observation. Each input consumes the observation. Esc or the visible STOP button ends control. The native top-center HUD reports current action, previous result/time, and optionally the caller-supplied genuine conversation title, never typed text; close_session is required before reporting completion. The controlled window has a light-blue translucent gradient outline; the real Windows mouse pointer is accentuated by a continuously following, mouse-transparent, light-blue gradient glow. Configured clients share one session. Session IDs route calls; they are not authorization. GUI effects are not confined by project directories.' + TASK_CONTINUITY_DESCRIPTION + SCREENSHOT_DESCRIPTION;
class WindowsComputerUse extends BaseComputerUse {
  constructor(options={}) {
    const helperPath=fs.existsSync(path.join(__dirname,'../ChatToHarness.ComputerUse.exe'))
      ? path.join(__dirname,'../ChatToHarness.ComputerUse.exe')
      : path.resolve(__dirname,'../resources/computer-use/ChatToHarness.ComputerUse.exe');
    const {supportedPlatform: _ignored, ...requested}=options;
    super({platform:process.platform,supportedPlatform:'win32',
      authorizationMode:process.env.CTH_COMPUTER_USE_AUTHORIZATION_MODE||'all_windows',
      helperPath,...requested,supportedPlatform:'win32'});
  }
}
module.exports={WindowsComputerUse,NativeConnection,definition,validate,KEYS};
