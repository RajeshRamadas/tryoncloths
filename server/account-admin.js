// Operator-only: passwords come from stdin; billing commands never take secrets.
import {AccountStore} from './accounts.js';
import {adminCommand} from './commercial-admin.js';
const args=process.argv.slice(2);
if(!process.env.TRYON_DATA_DIR||!args.length){
 console.error('Set TRYON_DATA_DIR. Commands: reset-password EMAIL (stdin), list-orgs, grant-credits ORG ai|photo AMOUNT REF, set-plan ORG pilot|starter|growth|chain, extend-trial ORG DAYS, suspend ORG.');process.exitCode=1;
}else{
 const store=new AccountStore(process.env.TRYON_DATA_DIR);
 try{
  if(args[0]==='reset-password'){
   let password='';for await(const chunk of process.stdin){password+=chunk;if(password.length>1024)throw new Error('Password input too long.');}
   await store.resetPassword(args[1],password.replace(/[\r\n]+$/,''));console.log('Password changed. All sessions for this account were revoked.');
  }else console.log(JSON.stringify(adminCommand(store,args)));
 }catch(e){console.error(e.status?e.message:'Admin command failed. Check arguments and database access.');process.exitCode=1;}finally{store.close();}
}
