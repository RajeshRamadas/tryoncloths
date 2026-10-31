import {AccountStore as RealAccountStore} from "../../server/accounts.js";
// Preserve established-pilot regression fixtures; production signups default to trials.
export class AccountStore extends RealAccountStore {
 constructor(directory){super(directory,{signupTrial:false});}
}
export {installAccountRoutes,accountUser} from '../../server/accounts.js';
