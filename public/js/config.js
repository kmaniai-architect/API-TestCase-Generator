const $ = id => document.getElementById(id);
const METHODS = ['GET','POST','PUT','PATCH','DELETE'];
const SAMPLES = {
  POST:{req:{name:"John Doe",email:"john@example.com",age:30,active:true,address:{city:"Chennai",zip:"600001"},tags:["a","b"]},
        res:{id:101,name:"John Doe",email:"john@example.com",age:30,active:true,address:{city:"Chennai",zip:"600001"},tags:["a","b"],createdAt:"2026-10-17T10:00:00Z"}},
  PUT:{req:{name:"John Doe",email:"john@example.com",age:31},res:{id:101,name:"John Doe",email:"john@example.com",age:31,updatedAt:"2026-10-17T10:00:00Z"}},
  PATCH:{req:{name:"John Updated"},res:{id:101,name:"John Updated",email:"john@example.com",age:31}},
  GET:{req:null,res:{id:1,name:"John Doe",email:"john@example.com",active:true,roles:[{id:1,name:"admin"}],createdAt:"2026-01-01T00:00:00Z"}},
  DELETE:{req:null,res:{message:"User deleted"}}
};
const AI_CAT='__ai__';   // category-chip value for "AI generated"
let method='POST', cases=[], openIds=new Set(), results={}, allOpen=false, catFilter='';
