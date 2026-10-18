const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
export function setToken(token) { if(token) localStorage.setItem("newtonite_token",token); else localStorage.removeItem("newtonite_token"); }
export async function api(path, options={}) {
  const token=localStorage.getItem("newtonite_token");
  const headers={"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`} : {}),...(options.headers||{})};
  const response=await fetch(`${API}${path}`,{...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) { const err=new Error(data.error||`Request failed (${response.status})`); err.status=response.status; err.data=data; throw err; }
  return data;
}
