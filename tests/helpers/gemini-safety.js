import {GEMINI_SAFETY_REVISION} from '../../server/gemini-moderation.js';

export const safeAssessment=role=>({role,people:role==='garment'?0:1,adultAppearance:role==='garment'?'no_person':'adult',faceVisible:role!=='garment',sexualized:false,exposedIntimateParts:false,unsafeContent:false,uncertain:false});
export const safetyResponse=(roles,changes={})=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({revision:GEMINI_SAFETY_REVISION,assessments:roles.map(safeAssessment)})}]},...changes}]});
export const responseForRequest=options=>{
  const body=JSON.parse(options.body),roles=body.contents[0].parts.filter(p=>p.text).map(p=>p.text.split('trusted role: ')[1]);
  return safetyResponse(roles);
};
