export const managementStyles = {
// ================== 模态框样式 ==================
modalBackdrop: {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--ds-bg-overlay-l1)',
  backdropFilter: 'blur(8px) saturate(150%)',
  WebkitBackdropFilter: 'blur(8px) saturate(150%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '24px'
},

modal: {
  width: 'min(560px, 100%)',
  backgroundColor: 'var(--ds-bg-raised)',
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '12px',
  boxShadow: 'var(--ds-border-l3)',
  overflow: 'hidden'
},

modalHeader: {
  padding: '18px 20px',
  borderBottom: 'none'
},

modalTitle: {
  margin: 0,
  fontSize: '18px',
  fontWeight: '700',
  color: 'var(--ds-text-primary)'
},

modalSubtitle: {
  margin: '8px 0 0',
  color: 'var(--ds-text-tertiary)',
  fontSize: '13px',
  lineHeight: 1.5
},

modalBody: {
  padding: '18px 20px',
  display: 'grid',
  gap: '14px'
},

formRow: {
  display: 'grid',
  gap: '7px'
},

formLabel: {
  fontSize: '12px',
  fontWeight: '700',
  color: 'var(--ds-text-tertiary)'
},

formInput: {
  width: '100%',
  height: '36px',
  borderRadius: '8px',
  border: '1px solid var(--ds-border-l2)',
  backgroundColor: 'var(--ds-bg-secondary)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--ds-text-primary)',
  padding: '0 10px',
  boxShadow: 'var(--glass-inner-hl)',
  transition: 'all 0.15s ease',
  outline: 'none'
},

modalFooter: {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '14px 20px',
  borderTop: '1px solid var(--ds-border-l2)',
  backgroundColor: 'var(--ds-bg-secondary)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  boxShadow: 'var(--glass-inner-hl)'
},

modalActions: {
  display: 'flex',
  gap: '8px',
  flexShrink: 0
},

textButton: {
  height: '34px',
  padding: '0 12px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'transparent',
  color: 'var(--ds-text-tertiary)',
  cursor: 'pointer',
  minWidth: '86px',
  whiteSpace: 'nowrap'
},

primaryAction: {
  height: '34px',
  padding: '0 14px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'var(--ds-brand)',
  color: 'var(--text-on-primary)',
  fontWeight: '700',
  cursor: 'pointer',
  minWidth: '108px',
  whiteSpace: 'nowrap'
},

formError: {
  color: 'var(--ds-status-error)',
  fontSize: '12px'
},

formHint: {
  color: 'var(--ds-text-secondary)',
  fontSize: '12px',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
},

// ================== 管理页面 ==================
managementOverlay: {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  backgroundColor: 'rgba(20, 20, 22, 0.45)',
  backdropFilter: 'blur(8px) saturate(150%)',
  WebkitBackdropFilter: 'blur(8px) saturate(150%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
},

managementContainer: {
  display: 'flex',
  width: '90vw',
  maxWidth: '800px',
  height: '80vh',
  maxHeight: '600px',
  backgroundColor: 'var(--ds-bg-raised)',
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '14px',
  boxShadow: 'var(--ds-border-l3)',
  overflow: 'hidden',
},

managementSidebar: {
  display: 'flex',
  flexDirection: 'column',
  width: '180px',
  minWidth: '180px',
  backgroundColor: 'var(--surface-hover)',
  backdropFilter: 'blur(16px) saturate(160%)',
  WebkitBackdropFilter: 'blur(16px) saturate(160%)',
  borderRight: '1px solid var(--ds-border-l2)',
  boxShadow: 'var(--glass-inner-hl)',
  paddingTop: '12px',
},

managementSidebarHeader: {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px 14px',
  color: 'var(--ds-text-primary)',
  borderBottom: '1px solid var(--ds-border-l2)',
  marginBottom: '4px',
},

managementTab: {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  height: '36px',
  padding: '0 14px',
  border: 'none',
  backgroundColor: 'transparent',
  color: 'var(--ds-text-tertiary)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  textAlign: 'left',
  transition: 'all 0.15s ease',
},

managementTabActive: {
  backgroundColor: 'var(--ds-brand-soft)',
  color: 'var(--ds-brand)',
  fontWeight: 700,
},

managementContent: {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  position: 'relative',
},

managementCloseBtn: {
  position: 'absolute',
  top: '10px',
  right: '10px',
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '6px',
  backgroundColor: 'var(--ds-bg-secondary)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--ds-text-tertiary)',
  cursor: 'pointer',
  fontSize: '13px',
  zIndex: 1,
  transition: 'all 0.15s ease',
  boxShadow: 'var(--glass-inner-hl)'
},

mgmtContentInner: {
  flex: 1,
  overflowY: 'auto',
  padding: '20px',
},

mgmtContentHeader: {
  marginBottom: '16px',
  padding: '8px 0 12px',
  borderBottom: 'none',
},

searchBox: {
  marginBottom: '12px',
},

searchInput: {
  width: '100%',
  height: '36px',
  padding: '0 12px 0 36px',
  borderRadius: '8px',
  border: '1px solid var(--ds-border-l2)',
  backgroundColor: 'var(--ds-bg-secondary)',
  color: 'var(--ds-text-primary)',
  fontSize: '13px',
  outline: 'none',
  transition: 'all 0.15s ease',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: '12px center',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  boxShadow: 'var(--glass-inner-hl)',
},

searchInputFocus: {
  borderColor: 'var(--ds-brand)',
},

searchEmptyHint: {
  padding: '24px 16px',
  textAlign: 'center',
  fontSize: '13px',
  color: 'var(--ds-text-tertiary)',
},

mgmtSection: {
  marginBottom: '16px',
},

mgmtSectionTitle: {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '24px',
  borderRadius: '999px',
  border: '1px solid transparent',
  backgroundColor: 'transparent',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--ds-text-tertiary)',
  textTransform: 'uppercase',
  padding: '0 2px',
},

mgmtCheckboxRow: {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
},

mgmtCheckbox: {
  width: '14px',
  height: '14px',
  accentColor: 'var(--ds-brand)',
  cursor: 'pointer',
},

// ================== 模型管理 ==================
modelGroup: {
  marginBottom: '8px',
  borderRadius: '8px',
  border: '1px solid var(--ds-border-l2)',
  backgroundColor: 'var(--ds-bg-secondary)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  boxShadow: 'var(--glass-inner-hl)',
  overflow: 'hidden',
},

modelGroupHeader: {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '10px 12px',
  border: 'none',
  backgroundColor: 'var(--ds-brand-soft)',
  color: 'var(--ds-text-primary)',
  cursor: 'pointer',
  fontSize: '13px',
  textAlign: 'left',
},

modelGroupBody: {
  borderTop: '1px solid var(--ds-border-l2)',
  padding: '8px',
},

modelCard: {
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '8px',
  marginBottom: '6px',
  backgroundColor: 'var(--glass-bg)',
  backdropFilter: 'blur(10px) saturate(140%)',
  WebkitBackdropFilter: 'blur(10px) saturate(140%)',
  boxShadow: 'var(--glass-inner-hl)',
  overflow: 'hidden',
},

modelCardHeader: {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
},

modelCardInfo: {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flex: 1,
  minWidth: 0,
},

modelCardName: {
  fontWeight: 600,
  fontSize: '13px',
  color: 'var(--ds-text-primary)',
},

modelCardActions: {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexShrink: 0,
},

modelActionBtn: {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '24px',
  height: '24px',
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '4px',
  backgroundColor: 'var(--ds-bg-secondary)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--ds-text-tertiary)',
  cursor: 'pointer',
  fontSize: '11px',
  transition: 'all 0.15s ease',
  boxShadow: 'var(--glass-inner-hl)'
},

modelAddBtn: {
  display: 'block',
  width: '100%',
  padding: '8px',
  border: '1px dashed var(--ds-border-l3)',
  borderRadius: '6px',
  backgroundColor: 'transparent',
  color: 'var(--ds-text-tertiary)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all 0.15s ease',
},

modelForm: {
  padding: '12px',
  borderTop: '1px solid var(--ds-border-l2)',
},

modelFormActions: {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '12px',
},

modelNameInput: {
  height: '28px',
  padding: '0 8px',
  borderRadius: '6px',
  border: '1px solid var(--ds-brand-soft)',
  backgroundColor: 'var(--ds-bg-secondary)',
  color: 'var(--ds-text-primary)',
  fontSize: '12px',
  width: '160px',
},

// ================== MCP 管理 ==================
mcpServerCard: {
  border: '1px solid var(--ds-border-l2)',
  borderRadius: '8px',
  marginBottom: '8px',
  backgroundColor: 'var(--glass-bg)',
  backdropFilter: 'blur(10px) saturate(140%)',
  WebkitBackdropFilter: 'blur(10px) saturate(140%)',
  boxShadow: 'var(--glass-inner-hl)',
  overflow: 'hidden',
},

mcpServerHeader: {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
},

mcpServerInfo: {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
}
};
