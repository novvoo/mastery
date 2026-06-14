import React from 'react';

export function SettingsMenu({
  agentOptions,
  setAgentOptions,
  onOpenLLMSetup,
  onClose,
}) {
  return (
    <div style={{
      position: 'fixed', left: '56px', bottom: '44px',
      width: '220px', backgroundColor: 'var(--surface-color)',
      border: 'none', borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 1000,
      padding: '8px', fontSize: '12px', color: 'var(--text-color)'
    }}>
      <div style={{padding:'4px 8px 8px',borderBottom:'none',marginBottom:'6px',fontWeight:'700',fontSize:'11px',color:'var(--text-muted)',textTransform:'uppercase'}}>
        ROOT
      </div>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
        onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
        onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
        <input type="checkbox" checked={agentOptions.autoSave}
          onChange={(e)=>setAgentOptions(p=>({...p,autoSave:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        Auto Save
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
        onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
        onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
        <input type="checkbox" checked={agentOptions.autoScroll !== false}
          onChange={(e)=>setAgentOptions(p=>({...p,autoScroll:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        Autoscroll
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
        onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
        onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
        <input type="checkbox" checked={agentOptions.debug || false}
          onChange={(e)=>setAgentOptions(p=>({...p,debug:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        Developer Mode
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}}
        onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
        onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
        <input type="checkbox" checked={agentOptions.verbose || false}
          onChange={(e)=>setAgentOptions(p=>({...p,verbose:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        Verbose logging
      </label>

      <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px'}}>
        <span style={{fontSize:'11px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>Max iterations</span>
        <input type="number" value={agentOptions.maxIterations}
          onChange={(e)=>setAgentOptions(p=>({...p,maxIterations:parseInt(e.target.value)||60}))}
          style={{width:'56px',height:'24px',borderRadius:'4px',border:'none',backgroundColor:'var(--surface-input)',color:'var(--text-color)',padding:'0 6px',fontSize:'11px'}}
          min={1} max={500}/>
      </div>

      <div style={{borderTop:'none',margin:'6px 0',padding:'6px 8px 0'}}>
        <button style={{width:'100%',height:'28px',borderRadius:'5px',border:'none',backgroundColor:'transparent',color:'var(--text-muted)',cursor:'pointer',fontSize:'11px',textAlign:'center'}}
          onClick={() => {
            onClose();
            onOpenLLMSetup();
          }}
          onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--surface-hover)'}
          onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='transparent'}>
          设置...
        </button>
      </div>
    </div>
  );
}
