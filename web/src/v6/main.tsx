import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {loadUI} from './store';
import './v6.css';

class Boundary extends React.Component<{children:React.ReactNode},{error:string}>{
 state={error:''};
 static getDerivedStateFromError(e:Error){return {error:e.message}}
 render(){return this.state.error?<div style={{fontFamily:'-apple-system, system-ui, sans-serif',padding:40,color:'#60646c',display:'flex',flexDirection:'column',gap:12,alignItems:'flex-start'}}><strong style={{color:'#1c2024'}}>CyberMe</strong><span>{this.state.error}</span><button type="button" onClick={()=>location.reload()}>Reload</button></div>:this.props.children}
}
void loadUI().finally(()=>createRoot(document.getElementById('cyberme-v6')!).render(<Boundary><App/></Boundary>));
