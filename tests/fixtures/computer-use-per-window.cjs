'use strict';
// Host-side test configuration; the production tool cannot change this policy.
process.env.CTH_COMPUTER_USE_AUTHORIZATION_MODE = 'per_window';
require(process.argv[2]);
