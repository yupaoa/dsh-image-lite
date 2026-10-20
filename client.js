/**
 * dsh-image-lite — Client half.
 *
 * - the dsh-image-lite card on the Plugins page (`plugins.bundle.config`, key
 *   `dsh-image-lite`): a self-contained model library (providers + models
 *   CRUD, stored in this entry's volatile `providers` field) next to the
 *   quick config (default model + default image spec → `active` /
 *   `activeAspect`). The UI is entirely its own (a compact provider row +
 *   inline form + quick-config pickers), with no other plugin required.
 * - Right sidebar tab 「生图工作台」: two-stage registration
 *   (sidebarRightTabs.register type + keyed `sidebar.right.pane.tab` body),
 *   corner entry in `conversation.session.header.corner`, and the panel
 *   closed loop: model pick / 7-stop aspect (both live from the entry),
 *   reference images (recent results / upload / paste), generate, result
 *   gallery + lightbox + "keep editing".
 * - `tool.call.toolview` for image_generate_lite: inline result cards,
 *   lightbox, and a "use this one" button that shares refs with the panel.
 *
 * Everything reads and writes one entry (`image-gen-lite`); no cross-plugin
 * configuration reads. The 出图/attachment/credential plumbing lives on the
 * host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-lite',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    // Icons are a cosmetic concern: if this runtime's module registry does
    // not resolve the primitives package for third-party clients, the module
    // must still activate (every icon use site degrades to text labels).
    let primitives = {}
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}
    } catch {
      primitives = {}
    }
    // A `position: fixed` overlay is still clipped when an ancestor creates a
    // containing block (`transform` / `filter` / `contain`) — the right sidebar
    // does. A portal into document.body keeps the lightbox on the real viewport,
    // full-window, like the viewer the conversation uses for its own images.
    let portalFactory = null
    try {
      const reactDom = require('react-dom')
      if (typeof reactDom?.createPortal === 'function') portalFactory = reactDom.createPortal
    } catch {
      portalFactory = null
    }
    const pickIcon = (...names) => names.map((n) => primitives[n]).find((v) => typeof v === 'function')
    const IconClose = pickIcon('IconCloseOutline16', 'IconCloseOutlineRegular', 'IconCloseOutlineMedium')
    const IconTrash = pickIcon('IconTrashOutline16', 'IconTrashOutlineRegular', 'IconTrashOutlineMedium')
    const IconPlus = pickIcon('IconPlusOutline16', 'IconPlusOutlineRegular', 'IconPlusOutlineMedium')
    const IconSparkle = pickIcon('IconSparkle16', 'IconSparkleRegular', 'IconSparkleMedium')

    const ENTRY_NS = 'image-gen-lite'
    const LOCALE_NS = 'image-gen-lite'
    const RPC_CHANNEL = '/image-gen-lite'
    const TAB_ID = 'dsh-image-lite'
    const TAB_KIND = 'image-gen-lite'
    const TOOL_NAME = 'image_generate_lite'
    const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', 'auto']
    const SUPPORTED_FORMAT = 'openai-images'
    const MAX_REFS = 5
    const SHARE_EVENT = 'dsh-image-lite-updated'
    const API_FORMATS = [
      { id: 'openai-images', note: '/images/generations · /images/edits' },
      { id: 'xai-images', note: 'aspect_ratio' },
      { id: 'gemini-image', note: 'generateContent' },
      { id: 'openai-chat-image', note: 'chat completions' },
    ]

    const en = {
      title: 'Image studio',
      cornerTooltip: 'Open the image studio',
      guideTitle: 'Image studio',
      guideDescription: 'Generate and iteratively edit images with the configured model.',
      model: 'Image model',
      modelPlaceholder: 'Pick a model',
      libEmpty: 'The model library is empty. Add a provider on the Plugins page (open the dsh-image-lite card).',
      aspect: 'Aspect ratio',
      refs: 'Reference images',
      refsEmpty: 'No references yet. Upload, paste, or click "keep editing" on a result below.',
      refsFull: 'Up to 5 reference images.',
      upload: 'Upload',
      clear: 'Clear',
      clearHint: 'Clear references, prompt and results to start a new picture.',
      paste: 'Paste an image here to add it as a reference.',
      refsSelected: 'Selected — press Ctrl+V to paste an image into this box.',
      removeRef: 'Remove reference',
      uploadFailed: 'Upload failed.',
      prompt: 'Describe the image (or the change).',
      promptPlaceholder: 'e.g. a red rabbit with headphones, studio light…',
      generate: 'Generate',
      generating: 'Generating…',
      keyConfigured: 'API key set',
      keyUnset: 'API key missing — set it on the Plugins page under dsh-image-lite.',
      noActive: 'Pick an image model to start.',
      noCwd: 'Session working directory is unavailable; generation is disabled.',
      results: 'Results',
      resultsEmpty: 'Generated images appear here.',
      useThis: 'Keep editing',
      useThisHint: 'Uses this image as the reference for the next generation.',
      errorPrefix: 'Generation failed',
      tvGenerating: 'Generating…',
      tvImage: 'Image',
      tvView: 'View image',
      tvLoading: 'Loading image…',
      tvLoadFailed: 'Could not load image. Click to retry.',
      tvDialog: 'Image preview',
      tvClose: 'Close',
      // settings card
      cardTitle: 'Image studio',
      cardIntro: 'Model library and quick defaults. Everything is stored in this plugin and takes effect on the next generation.',
      lib: 'Model library',
      libEmptyCard: 'No providers yet. Add one below.',
      addProvider: 'Add provider',
      editProvider: 'Edit provider',
      providerName: 'Name',
      providerId: 'ID',
      providerBase: 'Base URL',
      providerFormat: 'API format',
      providerKey: 'API key',
      providerKeyEnv: 'Credential name',
      keyModeEnv: 'Use an env var name',
      keyModeKey: 'Paste the key instead',
      keyPlaceholder: 'sk-… paste the API key',
      keyHint: 'Stored in the DSH credentials service — the config keeps only a masked preview.',
      keyStoredHint: 'Already stored: {hint}. Leave empty to keep it.',
      keyEnvHint: 'Read from the environment (or an existing credential) under this name.',
      keyReplaceHint: 'The old value here is not a credential name — paste the API key to replace it.',
      keyWriteFailed: 'Could not store the API key: {reason}',
      providerModels: 'Models',
      modelsHint: 'One model per line: `id` or `id  display name`.',
      save: 'Save',
      cancel: 'Cancel',
      deleteProvider: 'Delete',
      modelsCount: '{n} models',
      keySet: 'key set',
      keyMissing: 'key missing',
      idTaken: 'This ID is already in use — pick another one.',
      nameTaken: 'A provider with this name already exists — pick another name.',
      nameRequired: 'Give the provider a name or an ID first.',
      saveFailed: 'The configuration form rejected the write — nothing was saved.',
      unsupportedNote: 'only openai-images can generate in this version',
      quick: 'Quick config',
      defaultModel: 'Default model',
      defaultAspect: 'Default image spec',
      quickReady: 'Ready — this is what image_generate_lite uses.',
      sidebar: 'Sidebar',
      sidebarStudio: 'Use the image studio from the sidebar',
      sidebarStudioHint: 'Off applies at once; turning it back on restores the tab and header button after a window refresh. The image_generate_lite tool always works.',
      sidebarSaveFailed: 'Could not save the switch',
      browse: 'Open folder…',
      pickFailed: 'Could not open the folder picker',
      storage: 'Image folder',
      storagePlaceholder: 'Default: <session workspace> / generate/image',
      storageHint: 'Leave empty to store images under generate/image in the session workspace; a relative path is resolved against the workspace.',
      quickUnset: 'Pick a default model and it takes effect on the next call.',
      quickStale: 'The default model no longer exists in the library; pick one again.',
    }
    const zh = {
      title: '生图工作台',
      cornerTooltip: '打开生图工作台',
      guideTitle: '生图工作台',
      guideDescription: '用已配置的模型生成并迭代修改图片。',
      model: '生图模型',
      modelPlaceholder: '选择模型',
      libEmpty: '模型库为空。请到 插件 页面打开 dsh-image-lite 添加供应商。',
      aspect: '图片比例',
      refs: '参考图',
      refsEmpty: '暂无参考图。可上传、粘贴，或在下方结果里点「用这张继续」。',
      refsFull: '最多 5 张参考图。',
      upload: '上传',
      clear: '清空',
      clearHint: '清空参考图、描述和结果，开始新的生成。',
      paste: '粘贴图片即可添加为参考图。',
      refsSelected: '已选中这张参考图框，按 Ctrl+V 粘贴图片。',
      removeRef: '移除参考图',
      uploadFailed: '上传失败。',
      prompt: '描述图片（或要做的改动）。',
      promptPlaceholder: '例如：戴耳机的红色小兔，影棚光…',
      generate: '生成',
      generating: '生成中…',
      keyConfigured: '密钥已配置',
      keyUnset: '密钥缺失 — 请到 插件 页面的 dsh-image-lite 卡片里配置。',
      noActive: '请先选择一个生图模型。',
      noCwd: '会话工作目录不可用，无法生成。',
      results: '结果',
      resultsEmpty: '生成的图片会出现在这里。',
      useThis: '用这张继续',
      useThisHint: '把这张图作为下次生成的参考图。',
      errorPrefix: '生成失败',
      tvGenerating: '正在生成…',
      tvImage: '图片',
      tvView: '查看图片',
      tvLoading: '正在加载图片…',
      tvLoadFailed: '图片加载失败，点击重试。',
      tvDialog: '图片预览',
      tvClose: '关闭',
      cardTitle: '生图工作台',
      cardIntro: '模型库与快速配置。全部存于本插件，下一次生图即刻生效。',
      lib: '模型库',
      libEmptyCard: '还没有供应商。在下方添加一个。',
      addProvider: '添加供应商',
      editProvider: '编辑供应商',
      providerName: '名称',
      providerId: 'ID',
      providerBase: 'Base URL',
      providerFormat: '接口格式',
      providerKey: 'API 密钥',
      providerKeyEnv: '凭据名（环境变量）',
      keyModeEnv: '改用环境变量名',
      keyModeKey: '改回直接填密钥',
      keyPlaceholder: 'sk-… 粘贴 API 密钥',
      keyHint: '保存到 DSH 凭据服务，配置里只留加密预览。',
      keyStoredHint: '已保存：{hint}。留空则保持不变。',
      keyEnvHint: '从这个名字的环境变量（或已有凭据）读取。',
      keyReplaceHint: '原来那串不是凭据名，粘贴 API 密钥即可替换。',
      keyWriteFailed: '密钥保存失败：{reason}',
      providerModels: '模型',
      modelsHint: '每行一个模型：`id` 或 `id  显示名`。',
      save: '保存',
      cancel: '取消',
      deleteProvider: '删除',
      modelsCount: '{n} 个模型',
      keySet: '密钥已配',
      keyMissing: '密钥未配',
      idTaken: '该 ID 已被占用，请换一个。',
      nameTaken: '同名供应商已存在，请换一个名称。',
      nameRequired: '请先填写名称或 ID。',
      saveFailed: '配置表单拒绝了这次写入，没有保存成功。',
      unsupportedNote: '本版本仅 openai-images 可出图',
      quick: '快速配置',
      defaultModel: '默认模型',
      defaultAspect: '默认图片规格',
      quickReady: '已就绪 — image_generate_lite 将使用它。',
      sidebar: '侧边栏',
      sidebarStudio: '在侧边栏中使用生图工作台',
      sidebarStudioHint: '关闭立即生效；重新开启后刷新窗口即可恢复标签与按钮。image_generate_lite 工具始终可用。',
      sidebarSaveFailed: '开关保存失败',
      browse: '打开文件夹',
      pickFailed: '无法打开文件夹选择器',
      storage: '图片存放位置',
      storagePlaceholder: '留空则用：会话工作区 / generate/image',
      storageHint: '留空就用会话工作区的 generate/image/ 文件夹；相对路径按工作区解析。',
      quickUnset: '选好默认模型后，下一次调用即生效。',
      quickStale: '默认模型已不在模型库中，请重新选择。',
    }

    function translateFactory(dict) {
      return (key, params) => {
        let text = dict[key] ?? en[key] ?? key
        for (const [name, value] of Object.entries(params ?? {})) {
          text = String(text).replaceAll(`{${name}}`, String(value))
        }
        return text
      }
    }

    const css = {
      panel: { display: 'flex', flexDirection: 'column', gap: 14, padding: 16, color: 'var(--dsw-alias-label-primary)', fontSize: 14 },
      topbar: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: -6 },
      switch: { position: 'relative', flex: '0 0 auto', width: 40, height: 22, borderRadius: 11, border: 'none', padding: 0, cursor: 'pointer', transition: 'background .15s' },
      switchKnob: { position: 'absolute', top: 3, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .15s' },
      idle: { opacity: 0.45, cursor: 'not-allowed' },
      section: { display: 'flex', flexDirection: 'column', gap: 8 },
      row: { display: 'flex', alignItems: 'center', gap: 8 },
      heading: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', letterSpacing: '.04em' },
      label: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', flex: 'none' },
      hint: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
      error: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
      danger: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
      drop: { border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 8, padding: 8, outline: 'none', transition: 'border-color .12s, background .12s' },
      dropActive: { borderColor: 'var(--dsw-alias-state-focus-border, #4c8dff)', background: 'var(--dsw-alias-interactive-bg-hover)' },
      hintActive: { color: 'var(--dsw-alias-label-primary)' },
      grid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
      resultCard: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: 10,
        background: 'var(--dsw-alias-bg-layer-3)', display: 'flex', flexDirection: 'column', gap: 8,
      },
      chipImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      card: { display: 'flex', flexDirection: 'column', gap: 16, padding: 4, color: 'var(--dsw-alias-label-primary)', fontSize: 14 },
      libRow: {
        display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 10, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-3)',
      },
      libMeta: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' },
    }

    function ensurePanelCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-image-lite-panel"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-image-lite'
      tag.dataset.pluginCss = 'dsh-image-lite-panel'
      tag.textContent = [
        '.dsh-igl-select{box-sizing:border-box;height:36px;padding:0 12px;font:inherit;font-size:14px;line-height:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer}',
        '.dsh-igl-select:disabled{opacity:.5;cursor:default}',
        '.dsh-igl-input{box-sizing:border-box;height:32px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 10px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
        '.dsh-igl-input:focus{outline:none;border-color:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-border-l3))}',
        '.dsh-igl-textarea{box-sizing:border-box;width:100%;min-height:64px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;line-height:20px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);resize:vertical}',
        '.dsh-igl-textarea:focus{outline:none;border-color:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-border-l3))}',
        '.dsh-igl-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
        '.dsh-igl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-igl-btn:disabled{opacity:.5;cursor:default}',
        '.dsh-igl-primary{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;border-radius:16px;border:none;background:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:13px;cursor:pointer}',
        '.dsh-igl-primary:hover:not(:disabled){filter:brightness(1.08)}',
        '.dsh-igl-primary:disabled{opacity:.5;cursor:default}',
        '.dsh-igl-icon{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:0}',
        '.dsh-igl-icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-igl-corner{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.dsh-igl-corner:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dsh-igl-chip{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;flex:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-igl-chip img{width:100%;height:100%;object-fit:cover;display:block}',
        '.dsh-igl-empty{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px}',
        '.dsh-igl-badge{box-sizing:border-box;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:18px;flex:none}',
        '.dsh-igl-badgeset{box-sizing:border-box;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;font:inherit;font-size:11px;line-height:18px;flex:none;color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-tertiary))}',
        '.dsh-igl-badgeset.off{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-tertiary))}',
        '.dsh-igl-mchip{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px 0 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      ].join('')
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------ storage + share

    function storageKeyFor(sessionId) {
      return `dsh.image-gen-lite.v1.${typeof sessionId === 'string' && sessionId ? sessionId : 'global'}`
    }

    function normalizeSessionStore(parsed) {
      const store = { refs: [], prompt: '', recent: [] }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.refs)) {
          store.refs = parsed.refs
            .filter((ref) => ref && typeof ref === 'object' && typeof ref.attachmentId === 'string')
            .slice(0, MAX_REFS)
        }
        if (typeof parsed.prompt === 'string') store.prompt = parsed.prompt
        if (Array.isArray(parsed.recent)) {
          store.recent = parsed.recent
            .filter((row) => row && typeof row === 'object')
            .slice(0, 12)
            .map((row) => ({
              images: Array.isArray(row.images) ? row.images : [],
              paths: Array.isArray(row.paths) ? row.paths : [],
              provider: String(row.provider ?? ''),
              model: String(row.model ?? ''),
              aspect: String(row.aspect ?? ''),
              at: Number(row.at) || 0,
            }))
        }
      }
      return store
    }

    function readSessionStore(sessionId) {
      try {
        const raw = localStorage.getItem(storageKeyFor(sessionId))
        return normalizeSessionStore(raw ? JSON.parse(raw) : null)
      } catch {
        return normalizeSessionStore(null)
      }
    }

    function writeSessionStore(sessionId, store) {
      try {
        localStorage.setItem(storageKeyFor(sessionId), JSON.stringify(store))
      } catch {
        // storage unavailable: the session-scoped state simply does not persist
      }
    }

    /** Share refs from the toolview into the panel's reference list. */
    function shareRefsWithPanel(sessionId, refs) {
      if (!sessionId || !Array.isArray(refs) || refs.length === 0) return
      const store = readSessionStore(sessionId)
      const seen = new Set(store.refs.map((r) => r && r.attachmentId))
      const merged = []
      for (const ref of refs) {
        if (!ref || seen.has(ref.attachmentId)) continue
        seen.add(ref.attachmentId)
        merged.push(ref)
        if (merged.length === MAX_REFS) break
      }
      if (merged.length === 0) return
      store.refs = merged
      writeSessionStore(sessionId, store)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: { sessionId } }))
    }

    // ------------------------------------------------------------ model library (pure)

    function emptyActiveValue() {
      return { providerId: '', modelId: '', baseUrl: '', model: '', apiKeyEnv: '', apiFormat: '' }
    }

    /** Mirrors the host's `activeComplete`: every field the 出图 call needs. */
    function activeLooksComplete(active) {
      return !!(active && active.providerId && active.modelId && active.baseUrl
        && active.model && active.apiKeyEnv && active.apiFormat === SUPPORTED_FORMAT)
    }

    /** One provider+model option for the pickers. */
    function providerOptions(providers) {
      const options = []
      for (const provider of Array.isArray(providers) ? providers : []) {
        if (!provider || typeof provider !== 'object') continue
        for (const model of provider.models ?? []) {
          if (!model?.id) continue
          options.push({
            value: `${provider.id}::${model.id}`,
            label: `${provider.name || provider.id} / ${model.name || model.id}`,
            providerId: provider.id,
            modelId: model.id,
            apiFormat: provider.apiFormat,
          })
        }
      }
      return options
    }

    /** Options usable by this version's 出图 layer. */
    function modelOptionsFrom(providers) {
      return providerOptions(providers).filter((o) => o.apiFormat === SUPPORTED_FORMAT)
    }

    /** The six-field `active` value for a chosen option. */
    function buildActiveFromOption(option) {
      if (!option) return emptyActiveValue()
      return {
        providerId: option.providerId,
        modelId: option.modelId,
        baseUrl: option.baseUrl ?? '',
        model: option.modelId,
        apiKeyEnv: option.apiKeyEnv ?? '',
        apiFormat: option.apiFormat,
      }
    }

    /** The currently selected `providerId::modelId`, when it exists in the options. */
    function activeChoiceFor(active, options) {
      if (!active?.providerId || !active?.modelId) return ''
      const choice = `${active.providerId}::${active.modelId}`
      return options.some((o) => o.value === choice) ? choice : ''
    }

    /**
     * Keep `active` consistent with the library after an edit: refresh
     * mutable fields from the (possibly edited) provider, and clear the
     * selection when its provider or model disappeared.
     */
    function syncActiveWithProviders(active, providers) {
      if (!activeLooksComplete(active)) return emptyActiveValue()
      const provider = (providers ?? []).find((p) => p && p.id === active.providerId)
      const model = (provider?.models ?? []).find((m) => m?.id === active.modelId)
      if (!provider || !model) return emptyActiveValue()
      return {
        providerId: provider.id,
        modelId: model.id,
        baseUrl: provider.baseUrl,
        model: model.id,
        apiKeyEnv: provider.apiKeyEnv,
        apiFormat: provider.apiFormat,
      }
    }

    /** Parse the models textarea: `id` or `id  display name` per line. */
    function parseModelLines(text) {
      const models = []
      const seen = new Set()
      for (const rawLine of String(text ?? '').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line.length === 0 || line.startsWith('#')) continue
        const parts = line.split(/[\t ]{1,}/)
        const id = (parts.shift() ?? '').trim()
        if (id.length === 0 || seen.has(id)) continue
        seen.add(id)
        models.push({ id, name: parts.join(' ').trim() || id })
      }
      return models
    }

    /** A fresh, unique-enough provider id from a display name. */
    function slugForProvider(name, taken) {
      const base = String(name ?? '').trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
      let id = base || 'provider'
      let n = 2
      while (taken.has(id)) id = `${base || 'provider'}-${n++}`
      return id
    }

    // ---------------------------------------------------------------- RPC

    async function rpcCall(rpc, endpoint, payload) {
      const result = await rpc.call(RPC_CHANNEL, endpoint, payload)
      if (!result.ok) throw new Error(result.error?.message ?? String(result.error))
      return result.value
    }

    /**
     * Session-authorized loader first, then our own RPC. The core helper only
     * answers for attachments bound to the session, so a rejection there must
     * fall through instead of killing the tile.
     */
    function createImageLoader(ctx, rpc, sessionId) {
      return async (image, cwd) => {
        const ref = image?.attachment
        const file = image?.path
        if (ref) {
          if (typeof ctx?.uiConversation?.imageUrl === 'function') {
            try {
              const url = await ctx.uiConversation.imageUrl(sessionId, ref)
              if (typeof url === 'string' && url !== '') return url
            } catch {
              // fall through to the plugin channel
            }
          }
          const result = await rpcCall(rpc, 'image', ref)
          return `data:${result.mediaType};base64,${result.dataBase64}`
        }
        if (file) {
          const result = await rpcCall(rpc, 'file', { path: file, cwd: cwd || '' })
          return `data:${result.mediaType};base64,${result.dataBase64}`
        }
        throw new Error('no image to load')
      }
    }

    // ---------------------------------------------------------------- hooks

    function useSnapshot(scope) {
      const [snap, setSnap] = React.useState(() => scope.getSnapshot())
      React.useEffect(() => {
        setSnap(scope.getSnapshot())
        return scope.subscribe(() => setSnap(scope.getSnapshot()))
      }, [scope])
      return snap
    }

    function useSessionStore(sessionId) {
      const [store, setStore] = React.useState(() => readSessionStore(sessionId))
      React.useEffect(() => {
        setStore(readSessionStore(sessionId))
        const onChange = (event) => {
          const detail = event.detail ?? {}
          if (detail.sessionId === undefined || detail.sessionId === sessionId) {
            setStore(readSessionStore(sessionId))
          }
        }
        window.addEventListener(SHARE_EVENT, onChange)
        return () => window.removeEventListener(SHARE_EVENT, onChange)
      }, [sessionId])
      const update = React.useCallback((mutate) => {
        setStore((prev) => {
          const next = typeof mutate === 'function' ? mutate(prev) : { ...prev, ...mutate }
          writeSessionStore(sessionId, next)
          return next
        })
      }, [sessionId])
      return [store, update]
    }

    /** Whether the sidebar studio should be offered (default on). */
    function sidebarStudioEnabled(lite) {
      const value = lite?.getSnapshot?.()?.value
      return value?.sidebarEnabled !== false
    }

    /** The credentials Remote, however this runtime exposes it. */
    function credentialsOf(ctx) {
      return ctx?.remote?.credentials ?? ctx?.get?.('remote')?.credentials
    }

    /** Key-state for a list of credential names, from the credentials Remote. */
    function useKeyStates(ctx, envs, revision) {
      const [states, setStates] = React.useState({})
      const key = envs.filter((e) => typeof e === 'string' && e.length > 0).join('|')
      React.useEffect(() => {
        const list = key ? key.split('|') : []
        const credentials = credentialsOf(ctx)
        if (list.length === 0 || !credentials?.describe) return undefined
        let cancelled = false
        credentials.describe(list).then((response) => {
          if (cancelled) return
          const next = {}
          for (const env of list) next[env] = response?.ok ? response.value?.[env]?.configured === true : false
          setStates(next)
        }).catch(() => {})
        return () => { cancelled = true }
      }, [key, ctx?.remote, revision])
      return states
    }

    /**
     * Store one API key in the credentials service under `name`. The write is
     * what makes the provider usable; the config itself never holds the secret.
     */
    async function writeCredential(ctx, name, secret) {
      const credentials = credentialsOf(ctx)
      if (typeof credentials?.set !== 'function') {
        throw new Error('this DSH build has no writable credentials service')
      }
      const result = await credentials.set(name, secret)
      if (result && result.ok === false) {
        throw new Error(result.error?.message ?? 'credentials.set was rejected')
      }
    }

    /** The credential name a provider's key is stored under. */
    function credentialNameFor(providerId) {
      const slug = String(providerId ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      return `IMAGE_GEN_${slug || 'PROVIDER'}_API_KEY`
    }

    /** `MY_IMAGE_API_KEY` — a name a credential can be resolved by. */
    function looksLikeCredentialName(value) {
      return /^[A-Z][A-Z0-9_]*$/.test(String(value ?? '').trim())
    }

    /** `sk-0****32d`: how a stored key is shown back, never the key itself. */
    function maskSecret(value) {
      const text = String(value ?? '')
      if (text.length < 12) return text ? '*'.repeat(Math.min(text.length, 8)) : ''
      return `${text.slice(0, 4)}****${text.slice(-4)}`
    }

    // ------------------------------------------------------------ image tile

    function ImageTile({ image, load, t, onUse }) {
      const [src, setSrc] = React.useState(null)
      const [failed, setFailed] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const [tick, setTick] = React.useState(0)
      const key = image?.attachment?.attachmentId ?? image?.path ?? ''
      React.useEffect(() => {
        let cancelled = false
        setFailed(false)
        setSrc(null)
        Promise.resolve()
          .then(() => load(image, undefined))
          .then((url) => { if (!cancelled) setSrc(url) })
          .catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
      }, [key, tick])

      if (failed) {
        return React.createElement('button', {
          type: 'button', className: 'dsh-igl-icon',
          style: { width: 'auto', height: 'auto', padding: 4 },
          'aria-label': t('tvLoadFailed'),
          onClick: () => { setFailed(false); setTick((n) => n + 1) },
        }, t('tvLoadFailed'))
      }
      if (!src) return React.createElement('div', { className: 'dsh-igl-chip' })
      return React.createElement(React.Fragment, null,
        React.createElement('button', {
          type: 'button', className: 'dsh-igl-chip', style: { border: 'none', padding: 0, cursor: 'zoom-in' },
          'aria-label': t('tvView'),
          onClick: () => setOpen(true),
        }, React.createElement('img', { src, alt: t('tvImage'), style: css.chipImg })),
        open ? React.createElement(ImageLightbox, { src, t, onClose: () => setOpen(false) }) : null,
        onUse ? React.createElement('button', {
          type: 'button', className: 'dsh-igl-btn',
          title: t('useThisHint'),
          onClick: onUse,
        }, t('useThis')) : null,
      )
    }

    function ImageLightbox({ src, t, onClose }) {
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        // While the viewer is open the page behind it must not scroll, otherwise
        // a trackpad gesture scrolls the studio panel under the overlay.
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          window.removeEventListener('keydown', onKey)
          document.body.style.overflow = previousOverflow
        }
      }, [onClose])

      const overlay = React.createElement('div', {
        role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tvDialog'), className: 'dsh-igl-lightbox',
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2147483000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.82)', padding: 24,
        },
        onClick: onClose,
      },
        React.createElement('img', {
          src, alt: t('tvImage'),
          style: { maxWidth: '96vw', maxHeight: '92vh', width: 'auto', height: 'auto', objectFit: 'contain', borderRadius: 4, boxShadow: '0 18px 60px rgba(0,0,0,.55)' },
          onClick: (event) => event.stopPropagation(),
        }),
        React.createElement('button', {
          type: 'button', 'aria-label': t('tvClose'),
          style: {
            position: 'fixed', top: 16, right: 16, width: 36, height: 36, border: 'none',
            borderRadius: '50%', cursor: 'pointer', background: 'rgba(255,255,255,.18)', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          },
          onClick: onClose,
        }, IconClose ? React.createElement(IconClose, { size: 16 }) : t('tvClose')),
      )

      // No portal runtime (older bundle): still better than a clipped overlay.
      if (!portalFactory || typeof document === 'undefined') return overlay
      return portalFactory(overlay, document.body)
    }

    // ---------------------------------------------------------------- toolview

    function derivePrompt(argsRaw) {
      let parsed
      try { parsed = JSON.parse(argsRaw) } catch { parsed = undefined }
      let prompt
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.prompt === 'string') prompt = parsed.prompt
      const line = String(prompt ?? argsRaw).split('\n', 1)[0] ?? ''
      return line.length > 48 ? `${line.slice(0, 47)}…` : line
    }

    function blockImages(block) {
      const images = []
      for (const part of block?.content ?? []) {
        if (part?.type === 'image' && part.attachment) images.push({ attachment: part.attachment })
      }
      if (images.length > 0) return images
      const text = (block?.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
      const match = text.match(/Image references \(for image_generate_lite\.referenceImages\): (\[[\s\S]*\])\s*$/)
      if (match) {
        try {
          const refs = JSON.parse(match[1])
          for (const ref of refs) images.push({ attachment: ref })
        } catch { /* fall through to paths */ }
      }
      if (images.length === 0) {
        for (const line of text.split('\n')) {
          const m = line.match(/^\s*-\s+(\S+\.(?:png|jpe?g|webp|gif))\s*$/i)
          if (m) images.push({ path: m[1] })
        }
      }
      return images
    }

    function LiteToolview(props) {
      const { block } = props
      const t = props.t ?? translateFactory(en)
      if (block === undefined) return null
      const phase = typeof props.phase === 'string' ? props.phase : ('kind' in block ? 'result' : 'start')
      const settled = phase === 'result'
      const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
      const images = settled ? blockImages(block) : []
      // Plain closures: this component owns no hooks, so the early return
      // above stays safe (ImageTile owns its own hook effects).
      const selfLoad = (image, cwd) => createImageLoader(props.ctx, props.rpc, props.sessionId)(image, cwd)
      const load = (image, cwd) => {
        if (image?.attachment && typeof props.loadImage === 'function') {
          return Promise.resolve(props.loadImage(image.attachment))
        }
        return selfLoad(image, cwd ?? props.cwd)
      }
      const textParts = (block?.content ?? []).filter((p) => p?.type === 'text').map((p) => p.text)
      if (textParts.length === 0 && block.error) textParts.push(`${block.error.name ?? 'error'}: ${block.error.code ?? 'failed'}`)
      const text = textParts.join('\n')
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          IconSparkle ? React.createElement(IconSparkle, { size: 14 }) : null,
          React.createElement('span', {
            style: { fontSize: 13, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, `${TOOL_NAME}: ${derivePrompt(argsRaw)}`)),
        !settled ? React.createElement('p', { style: css.hint }, t('tvGenerating')) : null,
        settled && block.isError && text ? React.createElement('p', { style: css.error }, text.split('\n', 1)[0]) : null,
        settled && !block.isError && images.length > 0
          ? React.createElement('div', { style: css.grid },
            images.map((image, index) => React.createElement(ImageTile, {
              key: image.attachment?.attachmentId ?? image.path ?? index,
              image,
              load,
              t,
              onUse: image.attachment && props.sessionId
                ? () => shareRefsWithPanel(props.sessionId, [image.attachment])
                : undefined,
            })))
          : null,
        settled && !block.isError && images.length === 0 && text
          ? React.createElement('p', { style: { ...css.hint, whiteSpace: 'pre-wrap' } }, text)
          : null,
      )
    }

    // ------------------------------------------------------- settings card

    /**
     * The 插件配置 card: model library (provider CRUD) + quick config
     * (default model + default image spec). All writes go to this entry's
     * volatile fields through one atomic `mutate`.
     */
    function LiteBundleCard(props) {
      // The seat supplies `t` from the registration's locale; fall back for
      // runtimes that do not (so a missing translator degrades to English
      // instead of throwing during render).
      const t = props.t ?? translateFactory(en)
      const { ctx, liteForm } = props
      const snap = useSnapshot(liteForm)
      const providers = Array.isArray(snap.value?.providers) ? snap.value.providers : []
      const active = snap.value?.active
      const activeAspect = typeof snap.value?.activeAspect === 'string' && snap.value.activeAspect
        ? snap.value.activeAspect : ASPECTS[0]

      const [editing, setEditing] = React.useState(null) // provider draft or null
      const [saving, setSaving] = React.useState(false)
      const [providerError, setProviderError] = React.useState('')
      // Bumped after a credential write so the key badges re-read the service.
      const [keyRevision, setKeyRevision] = React.useState(0)
      const [storageError, setStorageError] = React.useState('')
      const [sidebarError, setSidebarError] = React.useState('')

      const keyStates = useKeyStates(ctx, [active?.apiKeyEnv, ...providers.map((p) => p.apiKeyEnv)], keyRevision)

      const options = React.useMemo(() => modelOptionsFrom(providers), [providers])
      const choice = activeChoiceFor(active, options)

      async function writeProviders(nextProviders, nextActive) {
        setSaving(true)
        let saved = true
        try {
          const result = await liteForm.mutate([
            { op: 'set', path: ['providers'], value: nextProviders },
            { op: 'set', path: ['active'], value: nextActive },
          ])
          // A rejected write (stale revision, read-only form) must say so
          // instead of silently leaving the card unchanged.
          saved = result !== false
        } catch {
          saved = false
        }
        setSaving(false)
        if (!saved) {
          setProviderError(t('saveFailed'))
          return false
        }
        setProviderError('')
        // The stored key changes what `credentials.describe` reports, so the
        // badges have to re-read it even when the credential name stays put.
        setKeyRevision((n) => n + 1)
        return true
      }

      function saveProvider(draft) {
        setProviderError('')
        const outcome = providerFromDraft(draft, providers)
        if (outcome.error) {
          setProviderError(t(outcome.error))
          return
        }
        const provider = outcome.provider
        const secret = String(draft.apiKey ?? '').trim()
        const persist = async () => {
          if (draft.apiKeyMode === 'env') {
            // A plain credential reference: nothing is stored here, the key is
            // read from the environment (or an existing stored credential).
            provider.apiKeyHint = ''
          }
          if (secret) {
            // The secret goes to the credentials service; the config only
            // keeps its name plus a masked preview. The name is derived from
            // the provider id, so a key pasted into a row that used to hold an
            // env-var name replaces that reference instead of overriding it.
            provider.apiKeyEnv = credentialNameFor(provider.id)
            provider.apiKeyHint = maskSecret(secret)
            await writeCredential(ctx, provider.apiKeyEnv, secret)
          }
          const ok = await writeProviders(outcome.nextProviders, syncActiveWithProviders(active, outcome.nextProviders))
          if (ok) setEditing(null)
        }
        void persist().catch((error) => {
          setSaving(false)
          setProviderError(t('keyWriteFailed', { reason: error?.message ?? String(error) }))
        })
      }

      function deleteProvider(id) {
        const nextProviders = providers.filter((p) => p.id !== id)
        void writeProviders(nextProviders, syncActiveWithProviders(active, nextProviders))
          .then((ok) => { if (ok) setEditing(null) })
      }

      function pickModel(value) {
        const option = options.find((o) => o.value === value)
        const provider = providers.find((p) => p.id === option?.providerId)
        const nextActive = option
          ? {
            ...buildActiveFromOption({ ...option, baseUrl: provider?.baseUrl, apiKeyEnv: provider?.apiKeyEnv }),
          }
          : emptyActiveValue()
        void liteForm.mutate([{ op: 'set', path: ['active'], value: nextActive }]).catch(() => {})
      }

      function pickAspect(value) {
        void liteForm.mutate([{ op: 'set', path: ['activeAspect'], value }]).catch(() => {})
      }

      function saveSidebarEnabled(next) {
        setSidebarError('')
        liteForm.mutate([{ op: 'set', path: ['sidebarEnabled'], value: next }])
          .then((result) => { if (result === false) setSidebarError(t('sidebarSaveFailed')) })
          .catch((error) => setSidebarError(t('sidebarSaveFailed') + ' ' + (error?.message ?? String(error))))
      }

      function saveOutputDir(value) {
        setStorageError('')
        liteForm.mutate([{ op: 'set', path: ['outputDir'], value }])
          .then((result) => {
            if (result === false) setStorageError(t('saveFailed'))
          })
          .catch((error) => setStorageError(`${t('saveFailed')} ${error?.message ?? String(error)}`))
      }

      const outputDir = typeof snap.value?.outputDir === 'string' ? snap.value.outputDir : ''
      const sidebarOn = snap.value?.sidebarEnabled !== false

      const activeComplete = activeLooksComplete(active)
      // Stale: the selection names a provider/model the library no longer has.
      const activeProvider = active?.providerId ? providers.find((p) => p.id === active.providerId) : undefined
      const activeStale = !!active?.providerId && !(activeProvider?.models ?? []).some((m) => m?.id === active?.modelId)

      return React.createElement('div', { style: css.card },
        React.createElement('p', { style: css.heading }, t('cardTitle')),
        React.createElement('p', { style: css.hint }, t('cardIntro')),
        // model library
        React.createElement('section', { style: css.section },
          React.createElement('h4', { style: css.heading }, t('lib')),
          providers.length === 0
            ? React.createElement('p', { className: 'dsh-igl-empty' }, t('libEmptyCard'))
            : providers.map((provider) => React.createElement(ProviderRow, {
              key: provider.id,
              provider,
              t,
              keySet: keyStates[provider.apiKeyEnv] === true,
              onEdit: () => setEditing(draftFromProvider(provider)),
              onDelete: () => deleteProvider(provider.id),
            })),
          React.createElement('div', { style: { ...css.row, justifyContent: 'flex-start' } },
            editing === null
              ? React.createElement('button', {
                type: 'button', className: 'dsh-igl-btn',
                onClick: () => setEditing(draftFromProvider(null, providers)),
              }, IconPlus ? React.createElement(IconPlus, { size: 12 }) : '+', t('addProvider'))
              : null,
          ),
          editing !== null
            ? React.createElement(ProviderForm, {
              key: editing.id || 'new', // remount so the draft resets when switching providers
              draft: editing,
              t,
              formats: API_FORMATS,
              busy: saving,
              onCancel: () => { setEditing(null); setProviderError('') },
              // The form owns the typed values; the outer draft never sees them.
              onSave: (values) => saveProvider(values ?? editing),
            })
            : null,
          providerError ? React.createElement('p', { style: css.error }, providerError) : null,
        ),
        // quick config
        React.createElement('section', { style: css.section },
          React.createElement('h4', { style: css.heading }, t('quick')),
          React.createElement('div', { style: css.row },
            React.createElement('span', { style: css.label }, t('defaultModel')),
            React.createElement('select', {
              className: 'dsh-igl-select', style: { flex: 1, minWidth: 0 },
              value: choice,
              disabled: snap.status !== 'ready',
              'aria-label': t('defaultModel'),
              onChange: (event) => pickModel(event.target.value),
            },
              options.length > 0 ? React.createElement('option', { value: '', disabled: true }, t('modelPlaceholder')) : null,
              options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label))),
          ),
          React.createElement('div', { style: css.row },
            React.createElement('span', { style: css.label }, t('defaultAspect')),
            React.createElement('select', {
              className: 'dsh-igl-select', style: { flex: 1, minWidth: 0 },
              value: activeAspect,
              disabled: snap.status !== 'ready',
              'aria-label': t('defaultAspect'),
              onChange: (event) => pickAspect(event.target.value),
            }, ASPECTS.map((a) => React.createElement('option', { key: a, value: a }, a))),
          ),
          activeStale
            ? React.createElement('p', { style: css.error }, t('quickStale'))
            : !activeComplete
              ? React.createElement('p', { style: css.hint }, t('quickUnset'))
              : keyStates[active?.apiKeyEnv] === false
                ? React.createElement('p', { style: css.error }, t('keyUnset'))
                : React.createElement('p', { style: css.hint }, t('quickReady')),
        ),
        // sidebar studio switch
        React.createElement('section', { style: css.section },
          React.createElement('h4', { style: css.heading }, t('sidebar')),
          React.createElement(ToggleRow, {
            label: t('sidebarStudio'),
            hint: t('sidebarStudioHint'),
            checked: sidebarOn,
            disabled: snap.status !== 'ready',
            onChange: (next) => saveSidebarEnabled(next),
          }),
          sidebarError ? React.createElement('p', { style: css.error }, sidebarError) : null,
        ),
        // where the files land
        React.createElement('section', { style: css.section },
          React.createElement('h4', { style: css.heading }, t('storage')),
          React.createElement(OutputDirField, {
            t,
            ctx,
            value: outputDir,
            disabled: snap.status !== 'ready',
            onCommit: saveOutputDir,
            onError: setStorageError,
          }),
          storageError ? React.createElement('p', { style: css.error }, storageError) : null,
          React.createElement('p', { style: css.hint }, t('storageHint')),
        ),
      )
    }

    /**
     * Text field for the image folder. The two buttons only show while the
     * field is being edited (it was just clicked), so the card stays quiet.
     * An empty value means the default directory.
     */
    /** One boolean row: a pill switch plus its label and hint. */
    function ToggleRow({ label, hint, checked, disabled, onChange }) {
      const onColor = 'var(--dsw-alias-state-focus-border, #4c8dff)'
      const offColor = 'var(--dsw-alias-border-l2, #555)'
      return React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      },
        React.createElement('div', { style: { minWidth: 0 } },
          React.createElement('span', { style: css.label }, label),
          hint ? React.createElement('p', { style: css.hint }, hint) : null,
        ),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          className: 'dsh-igl-switch',
          style: { ...css.switch, background: checked ? onColor : offColor, ...(disabled ? css.idle : null) },
          onClick: () => onChange(!checked),
        }, React.createElement('span', { style: { ...css.switchKnob, left: checked ? 21 : 3 } })),
      )
    }

    /**
     * Native folder chooser. The desktop shell injects
     * `__DSH_DIRECTORY_PICKER__`; other runtimes expose the same picker on the
     * workspace UI service. Resolves the chosen absolute path, or null when the
     * user cancels.
     */
    async function pickFolderPath(ctx) {
      const bridge = globalThis.__DSH_DIRECTORY_PICKER__
      if (bridge !== undefined && typeof bridge.pick === 'function') return await bridge.pick()
      const ui = ctx?.uiWorkspace ?? ctx?.get?.('uiWorkspace')
      if (ui !== undefined && typeof ui.pickDirectory === 'function') return await ui.pickDirectory()
      throw new Error('image_generate_lite: this runtime exposes no directory picker')
    }

    function OutputDirField({ t, value, disabled, onCommit, onError, ctx }) {

      const [text, setText] = React.useState(value)
      const [editing, setEditing] = React.useState(false)
      const inputRef = React.useRef(null)
      React.useEffect(() => { setText(value) }, [value])
      // Drop the focus too, so clicking the field again re-opens the buttons.
      const cancel = () => { setText(value); setEditing(false); inputRef.current?.blur() }
      const save = () => {
        const trimmed = String(text ?? '').trim()
        setText(trimmed)
        setEditing(false)
        inputRef.current?.blur()
        if (trimmed !== value) onCommit(trimmed)
      }
      // Keep the focus (and thus the buttons) alive while a button is pressed.
      const hold = (event) => event.preventDefault()
      const browse = async () => {
        if (disabled) return
        try {
          const picked = await pickFolderPath(ctx)
          if (typeof picked !== 'string' || picked.trim().length === 0) return // cancelled
          const next = picked.trim()
          setText(next)
          setEditing(false)
          inputRef.current?.blur()
          if (next !== value) onCommit(next)
        } catch (error) {
          onError?.(t('pickFailed') + ': ' + (error?.message ?? String(error)))
        }
      }
      return React.createElement('div', { style: { ...css.row, alignItems: 'flex-start' } },
        React.createElement('input', {
          ref: inputRef,
          className: 'dsh-igl-input',
          style: { flex: 1, minWidth: 0 },
          value: text,
          disabled,
          spellCheck: false,
          placeholder: t('storagePlaceholder'),
          'aria-label': t('storage'),
          onFocus: () => setEditing(true),
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') { event.preventDefault(); save() }
            else if (event.key === 'Escape') { event.preventDefault(); cancel() }
          },
        }),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-igl-btn',
          style: { whiteSpace: 'nowrap' },
          disabled,
          title: t('browse'),
          'aria-label': t('browse'),
          onMouseDown: hold,
          onClick: () => { void browse() },
        }, t('browse')),
        editing
          ? React.createElement('button', {
            type: 'button', className: 'dsh-igl-btn', style: css.danger, disabled,
            onMouseDown: hold, onClick: cancel,
          }, t('cancel'))
          : null,
        editing
          ? React.createElement('button', {
            type: 'button', className: 'dsh-igl-primary', disabled,
            onMouseDown: hold, onClick: save,
          }, t('save'))
          : null,
      )
    }

    /**
     * The editor draft for one provider (or a blank one for a new provider).
     * `apiKey` starts empty on purpose: a stored secret is never read back, and
     * an empty field means "keep the key that is already there".
     */
    function draftFromProvider(provider, providers) {
      if (provider === null) {
        void providers
        return {
          isNew: true, id: '', name: '', baseUrl: '', apiFormat: SUPPORTED_FORMAT,
          apiKeyEnv: '', apiKeyHint: '', apiKeyMode: 'key', apiKey: '', modelsText: '',
        }
      }
      const hasStoredKey = typeof provider.apiKeyHint === 'string' && provider.apiKeyHint.length > 0
      const pointsAtName = looksLikeCredentialName(provider.apiKeyEnv)
      return {
        isNew: false,
        id: provider.id,
        name: provider.name ?? '',
        baseUrl: provider.baseUrl ?? '',
        apiFormat: provider.apiFormat ?? SUPPORTED_FORMAT,
        apiKeyEnv: provider.apiKeyEnv ?? '',
        apiKeyHint: provider.apiKeyHint ?? '',
        // A provider that points at a credential name (no stored key) keeps
        // that mode; anything else is a key the user has to paste again.
        apiKeyMode: !hasStoredKey && pointsAtName ? 'env' : 'key',
        apiKey: '',
        modelsText: (provider.models ?? []).map((m) => (m.name && m.name !== m.id ? `${m.id}  ${m.name}` : m.id)).join('\n'),
      }
    }

    /**
     * Turn one editor draft into a library write. The editor keeps its typed
     * values in local state, so this is the single place those values become a
     * provider row — pure, so the save path is testable without a DOM.
     * @param draft - the editor's current values (`isNew` marks a fresh row).
     * @param providers - the library to write into.
     * @returns `{error}` when the draft is unusable, else the new row and library.
     */
    function providerFromDraft(draft, providers) {
      const name = String(draft?.name ?? '').trim()
      const id = String(draft?.id ?? '').trim()
      if (!name && !id) return { error: 'nameRequired' }
      // The ID is typed or derived from the name, and it is final: a collision
      // is reported, never silently renamed to `agnes-2`.
      const providerId = id || slugForProvider(name, new Set())
      const provider = {
        id: providerId,
        name: name || id,
        baseUrl: String(draft.baseUrl ?? '').trim(),
        apiFormat: draft.apiFormat || SUPPORTED_FORMAT,
        apiKeyEnv: String(draft.apiKeyEnv ?? '').trim(),
        apiKeyHint: String(draft.apiKeyHint ?? '').trim(),
        models: parseModelLines(draft.modelsText),
      }
      if (!provider.id) return { error: 'nameRequired' }
      // The edited row keeps its own id (the field is locked), so only a new
      // row can clash on the id.
      const exists = providers.some((p) => p.id === provider.id)
      if (draft.isNew !== false && exists) {
        // With no typed ID the collision is really the name's, so name it.
        return { error: id ? 'idTaken' : 'nameTaken' }
      }
      const others = providers.filter((p) => p.id !== provider.id)
      const lowerName = provider.name.toLowerCase()
      // A row keeps its own name even when a legacy duplicate carries it too,
      // so pre-existing duplicates stay editable; renaming onto another name
      // is always refused.
      const stored = providers.find((p) => p.id === provider.id)
      const nameUnchanged = !!stored && String(stored.name ?? '').trim().toLowerCase() === lowerName
      if (!nameUnchanged && others.some((p) => String(p.name ?? '').trim().toLowerCase() === lowerName)) {
        return { error: 'nameTaken' }
      }
      return {
        provider,
        nextProviders: exists
          ? providers.map((p) => (p.id === provider.id ? provider : p))
          : [...providers, provider],
      }
    }

    function ProviderRow({ provider, t, keySet, onEdit, onDelete }) {
      const models = provider.models ?? []
      const format = provider.apiFormat || SUPPORTED_FORMAT
      return React.createElement('div', { style: css.libRow },
        React.createElement('div', { style: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 } },
          React.createElement('div', { style: css.row },
            React.createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, provider.name || provider.id),
            React.createElement('span', { className: 'dsh-igl-badge' }, format),
            format !== SUPPORTED_FORMAT
              ? React.createElement('span', { className: 'dsh-igl-badge', title: t('unsupportedNote') }, t('unsupportedNote'))
              : null,
            React.createElement('span', {
              className: `dsh-igl-badgeset${keySet ? '' : ' off'}`,
            }, keySet ? t('keySet') : t('keyMissing')),
          ),
          React.createElement('div', { style: { ...css.libMeta, overflow: 'hidden' } },
            `${provider.baseUrl || '—'} · ${t('modelsCount', { n: models.length })}`
            + (provider.apiKeyHint ? ` · ${provider.apiKeyHint}` : '')),
          models.length > 0
            ? React.createElement('div', { style: { ...css.grid, marginTop: 4 } },
              models.map((m) => React.createElement('span', { key: m.id, className: 'dsh-igl-mchip' },
                m.name || m.id)))
            : null,
        ),
        React.createElement('div', { style: { display: 'flex', gap: 6, flex: 'none' } },
          React.createElement('button', { type: 'button', className: 'dsh-igl-btn', onClick: onEdit }, t('editProvider')),
          React.createElement('button', { type: 'button', className: 'dsh-igl-btn', onClick: onDelete, 'aria-label': t('deleteProvider') },
            IconTrash ? React.createElement(IconTrash, { size: 12 }) : t('deleteProvider')),
        ),
      )
    }

    function ProviderForm({ draft, t, formats, busy, onCancel, onSave }) {
      const [value, setValue] = React.useState(draft)
      const set = (key) => (event) => setValue((v) => ({ ...v, [key]: event.target.value }))
      return React.createElement('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
          border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
        },
      },
        React.createElement('p', { style: { ...css.heading, fontSize: 13 } }, value.isNew ? t('addProvider') : t('editProvider')),
        React.createElement('div', { style: css.formGrid },
          React.createElement('label', { style: css.row },
            React.createElement('span', { style: css.label }, t('providerName')),
            React.createElement('input', { className: 'dsh-igl-input', value: value.name, onChange: set('name'), 'aria-label': t('providerName') })),
          React.createElement('label', { style: css.row },
            React.createElement('span', { style: css.label }, t('providerId')),
            React.createElement('input', {
              className: 'dsh-igl-input', value: value.id, disabled: !value.isNew,
              placeholder: value.isNew ? 'auto (from name)' : '', onChange: set('id'), 'aria-label': t('providerId'),
            })),
          React.createElement('label', { style: { ...css.row, gridColumn: '1 / -1' } },
            React.createElement('span', { style: css.label }, t('providerBase')),
            React.createElement('input', {
              className: 'dsh-igl-input', value: value.baseUrl, onChange: set('baseUrl'),
              placeholder: 'https://…/v1', 'aria-label': t('providerBase'),
            })),
          React.createElement('label', { style: css.row },
            React.createElement('span', { style: css.label }, t('providerFormat')),
            React.createElement('select', {
              className: 'dsh-igl-select', value: value.apiFormat, onChange: set('apiFormat'),
              style: { flex: 1, minWidth: 0, maxWidth: 220 }, 'aria-label': t('providerFormat'),
            }, formats.map((f) => React.createElement('option', { key: f.id, value: f.id }, `${f.id} — ${f.note}`)))),
          React.createElement('div', { style: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 } },
            React.createElement('div', { style: { ...css.row, justifyContent: 'space-between' } },
              React.createElement('label', { style: css.label }, value.apiKeyMode === 'env' ? t('providerKeyEnv') : t('providerKey')),
              React.createElement('button', {
                type: 'button', className: 'dsh-igl-btn',
                onClick: () => setValue((v) => ({ ...v, apiKeyMode: v.apiKeyMode === 'env' ? 'key' : 'env' })),
              }, value.apiKeyMode === 'env' ? t('keyModeKey') : t('keyModeEnv'))),
            value.apiKeyMode === 'env'
              ? React.createElement('input', {
                className: 'dsh-igl-input', value: value.apiKeyEnv, onChange: set('apiKeyEnv'),
                placeholder: 'MY_IMAGE_API_KEY', 'aria-label': t('providerKeyEnv'),
              })
              : React.createElement('input', {
                className: 'dsh-igl-input', type: 'password', autoComplete: 'off', spellCheck: false,
                value: value.apiKey, onChange: set('apiKey'),
                placeholder: value.apiKeyHint ? t('keySaved', { hint: value.apiKeyHint }) : t('keyPlaceholder'),
                'aria-label': t('providerKey'),
              }),
            value.apiKeyMode === 'env'
              ? React.createElement('span', { style: css.hint }, t('keyEnvHint'))
              : value.apiKeyHint
                ? React.createElement('span', { style: css.hint }, t('keyStoredHint', { hint: value.apiKeyHint }))
                : value.apiKeyEnv && !looksLikeCredentialName(value.apiKeyEnv)
                  ? React.createElement('span', { style: css.hint }, t('keyReplaceHint'))
                  : React.createElement('span', { style: css.hint }, t('keyHint')),
          ),
          React.createElement('div', { style: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 } },
            React.createElement('label', { style: css.label }, t('providerModels')),
            React.createElement('textarea', {
              className: 'dsh-igl-textarea', value: value.modelsText, onChange: set('modelsText'),
              placeholder: 'gpt-image-1\ngpt-image-2  GPT Image 2', 'aria-label': t('providerModels'),
            }),
            React.createElement('span', { style: css.hint }, t('modelsHint')),
          ),
        ),
        React.createElement('div', { style: { ...css.row, justifyContent: 'flex-end' } },
          React.createElement('button', { type: 'button', className: 'dsh-igl-btn', onClick: onCancel }, t('cancel')),
          React.createElement('button', {
            type: 'button', className: 'dsh-igl-primary', disabled: busy,
            onClick: () => onSave(value),
          }, t('save')),
        ),
      )
    }

    // ---------------------------------------------------------------- studio panel

    function StudioBody(props) {
      const t = props.t ?? translateFactory(en)
      const { ctx, rpc, sessionId, liteForm, useSessions } = props
      const [store, updateStore] = useSessionStore(sessionId)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [prompt, setPrompt] = React.useState(store.prompt)
      const [refsFocus, setRefsFocus] = React.useState(false)

      const liteSnap = useSnapshot(liteForm)

      React.useEffect(() => { setPrompt(store.prompt) }, [store.prompt])

      const sessionsUse = typeof useSessions === 'function' ? useSessions : undefined
      const cwd = sessionsUse ? sessionsUse((all) => all.byId?.[sessionId]?.cwd) : undefined

      const providers = Array.isArray(liteSnap.value?.providers) ? liteSnap.value.providers : []
      const options = React.useMemo(() => modelOptionsFrom(providers), [providers])
      const active = liteSnap.value?.active
      const activeAspect = typeof liteSnap.value?.activeAspect === 'string' && liteSnap.value.activeAspect
        ? liteSnap.value.activeAspect : ASPECTS[0]
      const hasActive = activeLooksComplete(active)
      const choice = activeChoiceFor(active, options)

      const keyStates = useKeyStates(ctx, [active?.apiKeyEnv])

      const load = React.useCallback(
        (image) => createImageLoader(ctx, rpc, sessionId)(image, cwd),
        [ctx, rpc, sessionId, cwd],
      )

      async function pickModel(value) {
        const option = options.find((row) => row.value === value)
        if (!option) return
        const provider = providers.find((p) => p.id === option.providerId)
        try {
          await liteForm.mutate([{
            op: 'set',
            path: ['active'],
            value: {
              ...buildActiveFromOption({ ...option, baseUrl: provider?.baseUrl, apiKeyEnv: provider?.apiKeyEnv }),
            },
          }])
        } catch { /* the form's recovery read re-syncs the snapshot */ }
      }

      async function pickAspect(value) {
        try {
          await liteForm.mutate([{ op: 'set', path: ['activeAspect'], value }])
        } catch { /* snapshot resyncs */ }
      }

      async function addFiles(fileList) {
        const files = Array.from(fileList ?? []).filter((f) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type))
        if (files.length === 0) return
        const room = MAX_REFS - store.refs.length
        if (room <= 0) { setError(t('refsFull')); return }
        const items = []
        for (const file of files.slice(0, room)) {
          const data = await new Promise((resolveData, rejectData) => {
            const reader = new FileReader()
            reader.onload = () => resolveData(String(reader.result).split(',', 2)[1] ?? '')
            reader.onerror = () => rejectData(reader.error)
            reader.readAsDataURL(file)
          })
          items.push({ data, mediaType: file.type === 'image/jpg' ? 'image/jpeg' : file.type, name: file.name })
        }
        try {
          const value = await rpcCall(rpc, 'admitImages', { items })
          const fresh = value.refs.filter((ref) => !store.refs.some((r) => r.attachmentId === ref.attachmentId))
          if (fresh.length > 0) updateStore((prev) => ({ ...prev, refs: [...prev.refs, ...fresh].slice(0, MAX_REFS) }))
          setError('')
        } catch (err) {
          setError(`${t('uploadFailed')} ${err?.message ?? ''}`)
        }
      }

      function useThis(ref) {
        updateStore((prev) => {
          const rest = prev.refs.filter((r) => r.attachmentId !== ref.attachmentId)
          return { ...prev, refs: [ref, ...rest].slice(0, MAX_REFS) }
        })
        setError('')
      }

      function removeRef(ref) {
        updateStore((prev) => ({ ...prev, refs: prev.refs.filter((r) => r.attachmentId !== ref.attachmentId) }))
      }

      async function generate() {
        const text = prompt.trim()
        if (!text || busy) return
        setBusy(true)
        setError('')
        try {
          const value = await rpcCall(rpc, 'generate', {
            cwd,
            aspect: activeAspect,
            prompt: text,
            ...store.refs.length > 0 ? { refs: store.refs } : {},
          })
          updateStore((prev) => ({
            ...prev,
            prompt: text,
            recent: [{
              images: value.images ?? [],
              paths: value.paths ?? [],
              provider: value.provider,
              model: value.model,
              aspect: value.aspect,
              at: Date.now(),
            }, ...prev.recent].slice(0, 12),
          }))
        } catch (err) {
          setError(`${t('errorPrefix')}: ${err?.message ?? err}`)
        } finally {
          setBusy(false)
        }
      }

      const canGenerate = hasActive && !!cwd && prompt.trim().length > 0 && !busy
      const nothingToClear = store.refs.length === 0 && prompt.trim().length === 0 && store.recent.length === 0
      // Start over: references, prompt, results — the model and aspect stay.
      const clearPanel = () => {
        updateStore({ refs: [], prompt: '', recent: [] })
        setPrompt('')
        setError('')
      }

      return React.createElement('div', { style: css.panel, onPaste: (event) => {
        const files = Array.from(event.clipboardData?.items ?? [])
          .map((item) => item.getAsFile())
          .filter((f) => f !== null)
        if (files.length > 0) { event.preventDefault(); addFiles(files) }
      } },
        // Clear — top-right, red, disabled while a generation runs or when idle.
        React.createElement('div', { style: css.topbar },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-igl-btn',
            style: { ...css.danger, ...(busy || nothingToClear ? css.idle : null) },
            'aria-label': t('clear'),
            title: t('clearHint'),
            disabled: busy || nothingToClear,
            onClick: clearPanel,
          }, t('clear')),
        ),
        // Model
        React.createElement('div', { style: css.section },
          React.createElement('p', { style: css.heading }, t('model')),
          options.length === 0
            ? React.createElement('p', { className: 'dsh-igl-empty' }, t('libEmpty'))
            : React.createElement('select', {
              className: 'dsh-igl-select', style: { maxWidth: '100%' },
              value: choice,
              disabled: liteSnap.status !== 'ready',
              'aria-label': t('model'),
              onChange: (event) => pickModel(event.target.value),
            },
              React.createElement('option', { value: '', disabled: true }, t('modelPlaceholder')),
              options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label))),
          !hasActive ? React.createElement('p', { style: css.hint }, t('noActive')) : null,
          hasActive && keyStates[active?.apiKeyEnv] === false ? React.createElement('p', { style: css.error }, t('keyUnset')) : null,
          hasActive && keyStates[active?.apiKeyEnv] === true ? React.createElement('span', { style: { ...css.hint, alignSelf: 'flex-start' } }, t('keyConfigured')) : null,
        ),
        // Aspect
        React.createElement('div', { style: css.row },
          React.createElement('span', { style: css.label }, t('aspect')),
          React.createElement('select', {
            className: 'dsh-igl-select', style: { flex: 1, minWidth: 0 },
            value: activeAspect,
            disabled: liteSnap.status !== 'ready',
            'aria-label': t('aspect'),
            onChange: (event) => pickAspect(event.target.value),
          }, ASPECTS.map((a) => React.createElement('option', { key: a, value: a }, a))),
        ),
        // References — clicking this box selects it, so paste has a visible target.
        React.createElement('div', { style: css.section },
          React.createElement('p', { style: css.heading }, `${t('refs')} (${store.refs.length}/${MAX_REFS})`),
          React.createElement('div', {
            className: 'dsh-igl-drop',
            tabIndex: 0,
            role: 'group',
            'aria-label': t('refs'),
            'aria-describedby': 'dsh-igl-refs-hint',
            style: { ...css.drop, ...(refsFocus ? css.dropActive : null) },
            onFocus: () => setRefsFocus(true),
            onBlur: () => setRefsFocus(false),
            onClick: () => setRefsFocus(true),
            onPaste: (event) => {
              const files = Array.from(event.clipboardData?.items ?? [])
                .map((item) => item.getAsFile())
                .filter((f) => f !== null)
              if (files.length > 0) { event.preventDefault(); addFiles(files) }
            },
          },
            store.refs.length === 0
              ? React.createElement('p', { className: 'dsh-igl-empty', style: { margin: 0 } }, t('refsEmpty'))
              : React.createElement('div', { style: css.grid },
                store.refs.map((ref) => React.createElement('div', { key: ref.attachmentId, style: { position: 'relative' } },
                  React.createElement(ImageTile, { image: { attachment: ref }, load, t }),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-igl-icon',
                    style: {
                      position: 'absolute', top: 2, right: 2,
                      background: 'var(--dsw-alias-bg-module-platform)',
                    },
                    'aria-label': t('removeRef'),
                    onClick: () => removeRef(ref),
                  }, IconTrash ? React.createElement(IconTrash, { size: 12 }) : '×'),
                ))),
          ),
          React.createElement('div', { style: css.row },
            React.createElement('label', { className: 'dsh-igl-btn', style: { cursor: 'pointer' } },
              t('upload'),
              React.createElement('input', {
                type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true,
                style: { display: 'none' },
                onChange: (event) => { addFiles(event.target.files); event.target.value = '' },
              })),
            React.createElement('span', { id: 'dsh-igl-refs-hint', style: { ...css.hint, ...(refsFocus ? css.hintActive : null) } },
              refsFocus ? t('refsSelected') : t('paste')),
          ),
        ),
        // Prompt + generate
        React.createElement('div', { style: css.section },
          React.createElement('label', { style: { ...css.label, display: 'block' } }, t('prompt')),
          React.createElement('input', {
            className: 'dsh-igl-input', value: prompt, placeholder: t('promptPlaceholder'),
            onChange: (event) => setPrompt(event.target.value),
            'aria-label': t('prompt'),
          }),
          error ? React.createElement('p', { style: css.error, role: 'alert' }, error) : null,
          !cwd ? React.createElement('p', { style: css.hint }, t('noCwd')) : null,
          React.createElement('button', {
            type: 'button', className: 'dsh-igl-primary', disabled: !canGenerate, onClick: generate,
          }, busy ? t('generating') : t('generate')),
        ),
        // Results
        React.createElement('div', { style: css.section },
          React.createElement('p', { style: css.heading }, t('results')),
          store.recent.length === 0
            ? React.createElement('p', { className: 'dsh-igl-empty' }, t('resultsEmpty'))
            : store.recent.map((result, index) => React.createElement('div', { key: index, style: css.resultCard },
              result.images.length > 0
                ? React.createElement('div', { style: css.grid },
                  result.images.map((ref, i) => React.createElement(ImageTile, {
                    key: ref.attachmentId ?? i,
                    image: { attachment: ref },
                    load,
                    t,
                    onUse: () => useThis(ref),
                  })))
                : React.createElement('p', { style: css.hint }, (result.paths ?? []).join(', ')),
              React.createElement('span', { style: css.hint },
                `${result.provider ?? '—'} / ${result.model ?? '—'} · ${result.aspect ?? '—'}`),
            )),
        ),
      )
    }

    function StudioTitle(props) {
      const t = props.t ?? translateFactory(en)
      return React.createElement(React.Fragment, null,
        IconSparkle ? React.createElement(IconSparkle, { size: 16 }) : null,
        React.createElement('span', { style: { fontSize: 13, lineHeight: '20px' } }, t('title')),
      )
    }

    function CornerButton(props) {
      const t = props.t ?? translateFactory(en)
      return React.createElement('button', {
        type: 'button',
        className: 'dsh-igl-corner',
        title: t('cornerTooltip'),
        'aria-label': t('cornerTooltip'),
        onClick: props.openStudio,
      }, IconSparkle ? React.createElement(IconSparkle, { size: 16 }) : t('title'))
    }

    // ---------------------------------------------------------------- configForms

    /**
     * Guard against runtimes without the configuration forms service:
     * an inert scope keeps the panel mounted (read-only, nothing to pick).
     */
    function formScope(form) {
      if (!form || typeof form.getSnapshot !== 'function' || typeof form.mutate !== 'function') {
        return {
          getSnapshot: () => ({ status: 'unavailable', value: undefined, writable: false, revision: undefined }),
          subscribe: () => () => {},
          mutate: () => Promise.resolve(false),
        }
      }
      return form
    }

    // ---------------------------------------------------------------- inject + apply

    // 'settingsScope' was removed in DSH 0.1.7 (replaced by 'configForms').
    const inject = [
      'slots',
      'locale',
      'sidebarRight',
      'sidebarRightTabs',
      'connection',
      'remote',
      'remote.credentials',
      'configForms',
      'uiConversation',
      'sessions',
    ]

    /**
     * Run one registration on its own. The web shell turns any throw inside a
     * client entry into "entry did not activate" and refuses to boot the whole
     * UI, so a seat another plugin already owns (or one this DSH build no
     * longer declares) must only cost that one capability, never the entry.
     */
    const softly = (label, run) => {
      try {
        return run()
      } catch (error) {
        try {
          console.warn(`dsh-image-lite: ${label} unavailable`, error)
        } catch {}
        return undefined
      }
    }

    function apply(ctx) {
      softly('studio styles', ensurePanelCss)
      const t = ctx.locale.bind(LOCALE_NS)
      const lite = formScope(ctx.get('configForms')?.get?.(ENTRY_NS) ?? ctx.configForms?.get?.(ENTRY_NS))

      softly('copy dictionaries', () => ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { zh, en }),
        'dsh-image-lite: copy dictionaries',
      ))

      // 1-4. The sidebar studio, behind one reactive gate: the switch in the
      //      settings card hides (and restores) the tab type, its guide entry,
      //      the pane body and the header button without a window reload.
      softly('sidebar studio', () => ctx.effect(() => {
        let disposers = []
        const release = () => {
          for (const dispose of disposers) { try { dispose() } catch {} }
          disposers = []
        }
        const mount = () => {
          if (!sidebarStudioEnabled(lite)) return
          const register = (run) => {
            try { disposers.push(run()) } catch (error) {
              try { console.warn('dsh-image-lite: a studio seat failed to register', error) } catch {}
            }
          }
          // The tab type.
          register(() => ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => t('title'),
            guide: [{
              id: TAB_ID,
              order: 30,
              title: () => t('guideTitle'),
              description: () => t('guideDescription'),
            }],
            keepMounted: true,
          }))
          // The pane body (owner props come from the framework).
          register(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: LOCALE_NS,
            inject: (sessionId) => ({
              sessionId,
              ctx,
              rpc: ctx.get('connection')?.rpc ?? ctx.connection?.rpc,
              liteForm: lite,
            }),
          }, StudioBody)))
          // The chip title.
          register(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
            locale: LOCALE_NS,
          }, StudioTitle)))
          // The header entry. `conversation.session.header.corner` is a single slot
          // already claimed by the sidebar's expand button, so ours lives in the
          // neighbouring list seat, which accepts any number of buttons.
          register(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: TAB_ID,
            order: 40,
            locale: LOCALE_NS,
            inject: () => ({
              openStudio: () => {
                const controller = ctx.get('sidebarRight') ?? ctx.sidebarRight
                controller?.openTab?.(TAB_KIND)
              },
            }),
          }, CornerButton)))
        }
        const sync = () => { release(); mount() }
        mount()
        const stop = typeof lite.subscribe === 'function' ? lite.subscribe(sync) : undefined
        return () => { try { stop?.() } catch {} release() }
      }, 'dsh-image-lite: sidebar studio'))

      // 5. The settings card (model library + quick config, our entry only).
      softly('settings card', () => ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: TAB_ID,
        locale: LOCALE_NS,
        inject: () => ({
          ctx,
          liteForm: lite,
        }),
      }, LiteBundleCard)), 'dsh-image-lite: settings card'))

      // 6. The toolview for image_generate_lite.
      const rpc = ctx.get('connection')?.rpc ?? ctx.connection?.rpc
      if (rpc) {
        softly('toolview', () => ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: TOOL_NAME,
          locale: LOCALE_NS,
          inject: (sessionId) => ({
            sessionId,
            ctx,
            rpc,
          }),
        }, LiteToolview)), 'dsh-image-lite: toolview'))
      }
    }

    exports.apply = apply
    exports.inject = inject
    // Pure helpers exposed for the Node-side wiring tests.
    exports.lib = {
      emptyActiveValue,
      activeLooksComplete,
      providerOptions,
      modelOptionsFrom,
      buildActiveFromOption,
      activeChoiceFor,
      syncActiveWithProviders,
      parseModelLines,
      slugForProvider,
      draftFromProvider,
      providerFromDraft,
      maskSecret,
      credentialNameFor,
      looksLikeCredentialName,
      API_FORMATS,
      ASPECTS,
      SUPPORTED_FORMAT,
      MAX_REFS,
    }
    return module.exports
  },
})
