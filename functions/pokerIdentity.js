'use strict';
// Public appearance only. Never copy profile permissions, balances or game state.
function appearance(profile={},uid=''){
 return {photo:profile.photo||'',avatarSeed:profile.avatarSeed||uid};
}
module.exports={appearance};
