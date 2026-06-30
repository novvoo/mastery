import React from 'react';
import { t, getI18n, SupportedLanguages } from '../i18n.js';

export function SettingsMenu({
  agentOptions,
  setAgentOptions,
  theme,
  onToggleTheme,
  onOpenLLMSetup,
  onClose,
  language,
  onChangeLanguage,
}) {
  const i18n = getI18n();
  const currentLang = language || i18n.getLanguage();

  const handleLanguageChange = (lang) => {
    onChangeLanguage && onChangeLanguage(lang);
  };

  const rowHover = {
    onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'var(--glass-bg-light)',
    onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent',
  };

  return (
    <div style={{
      position: 'fixed', left: '56px', bottom: '44px',
      width: '260px', backgroundColor: 'var(--surface-color)',
      border: '1px solid var(--glass-border)',
      borderRadius: '12px',
      boxShadow: 'var(--glass-shadow-lg)', zIndex: 1000,
      padding: '10px', fontSize: '12px', color: 'var(--text-color)',
      userSelect: 'text',
    }}>
      <div style={{padding:'4px 8px 8px',borderBottom:'none',marginBottom:'6px',fontWeight:'700',fontSize:'11px',color:'var(--text-muted)',textTransform:'uppercase'}}>
        {t('ui.root')}
      </div>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
        <input type="checkbox" checked={agentOptions.autoSave}
          onChange={(e)=>setAgentOptions(p=>({...p,autoSave:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        {t('ui.auto_save')}
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
        <input type="checkbox" checked={agentOptions.autoScroll !== false}
          onChange={(e)=>setAgentOptions(p=>({...p,autoScroll:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        {t('ui.auto_scroll')}
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
        <input type="checkbox" checked={agentOptions.debug || false}
          onChange={(e)=>setAgentOptions(p=>({...p,debug:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        {t('ui.developer_mode')}
      </label>

      <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
        <input type="checkbox" checked={agentOptions.verbose || false}
          onChange={(e)=>setAgentOptions(p=>({...p,verbose:e.target.checked}))}
          style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
        {t('ui.verbose_logging')}
      </label>

      {/* 语言切换区域 */}
      <div style={{borderTop:'1px solid var(--glass-border)',margin:'6px 0',paddingTop:'6px'}}>
        <div style={{padding:'4px 8px 6px',fontWeight:'700',fontSize:'11px',color:'var(--text-muted)',textTransform:'uppercase'}}>
          {t('ui.language')}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-CN'}
            onChange={()=>handleLanguageChange('zh-CN')}
            style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
          {t('ui.language_zh')}
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'en'}
            onChange={()=>handleLanguageChange('en')}
            style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
          {t('ui.language_en')}
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
          <input type="radio" name="language" checked={currentLang === 'zh-TW'}
            onChange={()=>handleLanguageChange('zh-TW')}
            style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
          {t('ui.language_tw')}
        </label>
      </div>

      {/* 主题切换区域 */}
      <div style={{borderTop:'1px solid var(--glass-border)',margin:'6px 0',paddingTop:'6px'}}>
        <div style={{padding:'4px 8px 6px',fontWeight:'700',fontSize:'11px',color:'var(--text-muted)',textTransform:'uppercase'}}>
          {t('ui.theme')}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'light'}
            onChange={onToggleTheme}
            style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
          {t('ui.theme_light')}
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px',borderRadius:'4px',cursor:'pointer'}} {...rowHover}>
          <input type="radio" name="theme" checked={theme === 'dark'}
            onChange={onToggleTheme}
            style={{width:'14px',height:'14px',accentColor:'var(--primary-color)',cursor:'pointer'}}/>
          {t('ui.theme_dark')}
        </label>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'5px 8px'}}>
        <span style={{fontSize:'11px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{t('ui.max_iterations')}</span>
        <input type="number" value={agentOptions.maxIterations}
          onChange={(e)=>setAgentOptions(p=>({...p,maxIterations:parseInt(e.target.value)||60}))}
          style={{width:'56px',height:'24px',borderRadius:'6px',border:'1px solid var(--glass-border)',backgroundColor:'var(--glass-bg-light)',color:'var(--text-color)',padding:'0 6px',fontSize:'11px'}}
          min={1} max={500}/>
      </div>

      <div style={{borderTop:'none',margin:'6px 0',padding:'6px 8px 0'}}>
        <button style={{width:'100%',height:'28px',borderRadius:'6px',border:'1px solid var(--glass-border)',backgroundColor:'var(--glass-bg-light)',color:'var(--text-color)',cursor:'pointer',fontSize:'11px',textAlign:'center'}}
          onClick={() => {
            onClose();
            onOpenLLMSetup();
          }}
          onMouseEnter={(e)=>e.currentTarget.style.backgroundColor='var(--glass-bg-strong)'}
          onMouseLeave={(e)=>e.currentTarget.style.backgroundColor='var(--glass-bg-light)'}>
          {t('ui.setup')}
        </button>
      </div>
    </div>
  );
}
