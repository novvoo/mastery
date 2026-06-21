export const managementStyles = {
// ================== 模态框样式 ==================
modalBackdrop: {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--overlay-soft)',
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
  backgroundColor: 'var(--surface-color)',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  boxShadow: 'var(--glass-shadow-lg)',
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
  color: 'var(--text-color)'
},

modalSubtitle: {
  margin: '8px 0 0',
  color: 'var(--text-muted)',
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
  color: 'var(--text-muted)'
},

formInput: {
  width: '100%',
  height: '36px',
  borderRadius: '8px',
  border: '1px solid var(--glass-border)',
  backgroundColor: 'var(--glass-bg-light)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--text-color)',
  padding: '0 10px',
  boxShadow: 'var(--glass-inner-hl)',
  transition: 'all var(--transition-fast)',
  outline: 'none'
},

modalFooter: {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  padding: '14px 20px',
  borderTop: '1px solid var(--glass-border)',
  backgroundColor: 'var(--glass-bg-light)',
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
  color: 'var(--text-muted)',
  cursor: 'pointer',
  minWidth: '86px',
  whiteSpace: 'nowrap'
},

primaryAction: {
  height: '34px',
  padding: '0 14px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: 'var(--primary-color)',
  color: 'var(--text-on-primary)',
  fontWeight: '700',
  cursor: 'pointer',
  minWidth: '108px',
  whiteSpace: 'nowrap'
},

formError: {
  color: 'var(--error-color)',
  fontSize: '12px'
},

formHint: {
  color: 'var(--text-dark)',
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
  backgroundColor: 'var(--surface-color)',
  border: '1px solid var(--glass-border)',
  borderRadius: '14px',
  boxShadow: 'var(--glass-shadow-lg)',
  overflow: 'hidden',
},

managementSidebar: {
  display: 'flex',
  flexDirection: 'column',
  width: '180px',
  minWidth: '180px',
  backgroundColor: 'var(--glass-bg)',
  backdropFilter: 'blur(16px) saturate(160%)',
  WebkitBackdropFilter: 'blur(16px) saturate(160%)',
  borderRight: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-inner-hl)',
  paddingTop: '12px',
},

managementSidebarHeader: {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px 14px',
  color: 'var(--text-color)',
  borderBottom: '1px solid var(--glass-border)',
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
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  textAlign: 'left',
  transition: 'all var(--transition-fast)',
},

managementTabActive: {
  backgroundColor: 'var(--primary-soft)',
  color: 'var(--primary-color)',
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
  border: '1px solid var(--glass-border)',
  borderRadius: '6px',
  backgroundColor: 'var(--glass-bg-light)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '13px',
  zIndex: 1,
  transition: 'all var(--transition-fast)',
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
  color: 'var(--text-muted)',
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
  accentColor: 'var(--primary-color)',
  cursor: 'pointer',
},

// ================== 模型管理 ==================
modelGroup: {
  marginBottom: '8px',
  borderRadius: '8px',
  border: '1px solid var(--glass-border)',
  backgroundColor: 'var(--glass-bg-light)',
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
  backgroundColor: 'var(--title-capsule-bg)',
  color: 'var(--text-color)',
  cursor: 'pointer',
  fontSize: '13px',
  textAlign: 'left',
},

modelGroupBody: {
  borderTop: '1px solid var(--glass-border)',
  padding: '8px',
},

modelCard: {
  border: '1px solid var(--glass-border)',
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
  color: 'var(--text-color)',
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
  border: '1px solid var(--glass-border)',
  borderRadius: '4px',
  backgroundColor: 'var(--glass-bg-light)',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '11px',
  transition: 'all var(--transition-fast)',
  boxShadow: 'var(--glass-inner-hl)'
},

modelAddBtn: {
  display: 'block',
  width: '100%',
  padding: '8px',
  border: '1px dashed var(--glass-border-strong)',
  borderRadius: '6px',
  backgroundColor: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 500,
  transition: 'all var(--transition-fast)',
},

modelForm: {
  padding: '12px',
  borderTop: '1px solid var(--glass-border)',
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
  border: '1px solid var(--primary-soft)',
  backgroundColor: 'var(--glass-bg-light)',
  color: 'var(--text-color)',
  fontSize: '12px',
  width: '160px',
},

// ================== MCP 管理 ==================
mcpServerCard: {
  border: '1px solid var(--glass-border)',
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
