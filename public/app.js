const state = {
  user: null,
  authenticated: false,
  online: navigator.onLine,
  csrfToken: null,
  capabilities: {},
  memos: [],
  folders: [],
  tags: [],
  guestMemos: [],
  guestFolders: [],
  activeTag: "",
  selectedFolder: "",
  current: null,
  autosaveTimer: null,
  dirty: false,
  pendingSaveAction: null,
  pendingUnsavedPrompt: null,
  pendingUnsavedResolve: null,
  activePanel: "preview",
  authMode: "login",
  deleteAccountOpen: false,
  route: { page: "list", memoId: "" },
  isApplyingRoute: false,
  selectedMemoIds: new Set(),
  editorMode: localStorage.getItem("chrononote.editorMode") || "source",
  themePreference: localStorage.getItem("chrononote.themePreference") || localStorage.getItem("chrononote.theme") || "system",
  uiPreference: localStorage.getItem("chrononote.uiPreference") || "mobile",
  orientationLockPreference: localStorage.getItem("chrononote.orientationLock") || "auto",
  effectiveUiPreference: "mobile",
  resolvedTheme: "light",
  sidebarCollapsed: localStorage.getItem("chrononote.sidebar") === "collapsed",
  inspectorCollapsed: localStorage.getItem("chrononote.inspector") === "collapsed",
  inspectorWidth: Number(localStorage.getItem("chrononote.inspectorWidth") || 420),
  tooltipTimer: null,
  folderPickerOpen: false,
  iconEditor: null,
  emailCheckTimer: null,
  emailCheckRequest: 0,
  emailAvailability: null,
  drag: null,
  tutorialIndex: 0,
  mobileWritingTimer: null,
  deferredInstallPrompt: null,
  pwaInstalled: isStandaloneDisplay(),
  guestAttachments: new Map(),
  guestAttachmentCounter: 0
};

const $ = (selector) => document.querySelector(selector);
const TEXT_IMPORT_TOTAL_LIMIT_BYTES = 20 * 1024 * 1024;
const TRASH_FOLDER_NAME = "휴지통";
const TRASH_FOLDER_ICON = "🗑";
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_MAX_DIMENSION = 3200;
const IMAGE_WEBP_QUALITIES = [0.92, 0.88, 0.82];
const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg"]);
const TEXT_IMPORT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml",
  "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp",
  "h", "hpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "zsh", "fish", "sql",
  "ini", "conf", "env", "properties"
]);
const START_GUIDE_TITLE_PATTERN = /ChronoNote\s*시작\s*가이드|시작\s*가이드/;
const START_GUIDE_TUTORIAL_LINK_PATTERN = /^\s*\[튜토리얼 시작하기\]\(chrononote:tutorial\)\s*$/gm;
const START_GUIDE_LINK_NOTE_PATTERN = /^\s*위 링크는 .*작동합니다\.\s*$/gm;
const DATA_IMAGE_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;
const DATA_IMAGE_MARKDOWN_PATTERN = /!\[([^\]\n]{0,160})\]\((data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+)\)/gi;
const SAFE_SVG_TAGS = [
  "svg", "g", "defs", "title", "desc",
  "circle", "ellipse", "rect", "line", "polyline", "polygon", "path",
  "text", "tspan", "linearGradient", "radialGradient", "lineargradient", "radialgradient", "stop"
];
const SAFE_SVG_ATTRS = [
  "xmlns", "viewBox", "viewbox", "preserveAspectRatio", "preserveaspectratio",
  "width", "height", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "stroke", "stroke-width", "strokewidth", "stroke-linecap", "strokelinecap",
  "stroke-linejoin", "strokelinejoin", "stroke-dasharray", "strokedasharray",
  "stroke-dashoffset", "strokedashoffset", "fill-rule", "fillrule", "clip-rule",
  "cliprule", "opacity", "fill-opacity", "fillopacity", "stroke-opacity",
  "strokeopacity", "font-size", "fontsize", "font-family", "fontfamily",
  "font-weight", "fontweight", "text-anchor", "textanchor", "dominant-baseline",
  "dominantbaseline", "offset", "stop-color", "stopcolor", "stop-opacity",
  "stopopacity", "gradientUnits", "gradientunits", "gradientTransform", "gradienttransform"
];
const TUTORIAL_STEPS = [
  { route: "list", target: ".mobile-list-heading", title: "메모 목록", text: "처음 화면은 메모 목록입니다. 여기서 검색하고, 태그로 좁히고, 메모를 열어 작성 화면으로 들어갑니다." },
  { route: "list", target: ".sidebar-actions", title: "목록 작업", text: "검색창 옆 버튼으로 텍스트 파일을 가져오거나 새 메모를 만듭니다. 폴더는 목록에서 만들고 정리합니다." },
  { route: "list", target: "#memoList", title: "선택과 이동", text: "메모를 꾹 누르면 선택됩니다. 선택된 메모를 다시 꾹 누른 채 끌면 하나 또는 여러 개가 묶여서 이동합니다." },
  { route: "editor", target: "#mobileAppBar", title: "작성 화면", text: "작성 화면 위쪽은 작게 정리했습니다. 왼쪽 돌아가기를 누르면 메모 목록으로 돌아갑니다." },
  { route: "editor", target: ".toolbar-actions", title: "상단 기능", text: "이미지 삽입, 히스토리, 원본/보기 전환, 저장은 제목 오른쪽의 작은 버튼들에 모아두었습니다." },
  { route: "editor", target: "#contentInput", title: "본문 작성", text: "본문에는 Markdown을 쓰고, 안전한 HTML/CSS, SVG, LaTeX, 이미지와 움짤까지 함께 다룹니다." },
  { route: "settings", target: "#settingsAccountCard", title: "계정과 설정", text: "설정은 전체 페이지로 열립니다. 맨 위에서 계정 상태를 보고 로그인, 로그아웃, 동기화 설정을 관리합니다." },
  { route: "settings", target: "#settingsTutorialButton", title: "다시 보기", text: "튜토리얼은 설정 아래쪽의 작은 링크에서 언제든 다시 열 수 있습니다." }
];

const elements = {
  appShell: $("#appShell"),
  editorPane: $(".editor-pane"),
  mobileAppBar: $("#mobileAppBar"),
  mobileMenuButton: $("#mobileMenuButton"),
  mobileTitleButton: $("#mobileTitleButton"),
  mobileTitleLabel: $("#mobileTitleLabel"),
  mobileSubtitleLabel: $("#mobileSubtitleLabel"),
  mobileSearchButton: $("#mobileSearchButton"),
  mobileNewMemoButton: $("#mobileNewMemoButton"),
  editorBackButton: $("#editorBackButton"),
  mobileTabBar: $("#mobileTabBar"),
  mobileNotesTab: $("#mobileNotesTab"),
  mobileWriteTab: $("#mobileWriteTab"),
  mobileViewTab: $("#mobileViewTab"),
  mobileAccountTab: $("#mobileAccountTab"),
  mobileSettingsTab: $("#mobileSettingsTab"),
  sidebarToggleButton: $("#sidebarToggleButton"),
  railNewMemoButton: $("#railNewMemoButton"),
  railSearchButton: $("#railSearchButton"),
  railRecentButton: $("#railRecentButton"),
  railSettingsButton: $("#railSettingsButton"),
  accountButton: $("#accountButton"),
  accountSummaryButton: $("#accountSummaryButton"),
  settingsButton: $("#settingsButton"),
  accountInitial: $("#accountInitial"),
  accountSummaryEmail: $("#accountSummaryEmail"),
  accountProviderBadge: $("#accountProviderBadge"),
  accountProviderLabel: $("#accountProviderLabel"),
  accountUserId: $("#accountUserId"),
  mobileListCount: $("#mobileListCount"),
  memoSelectionBar: $("#memoSelectionBar"),
  memoSelectionCount: $("#memoSelectionCount"),
  pinSelectedMemosButton: $("#pinSelectedMemosButton"),
  restoreSelectedMemosButton: $("#restoreSelectedMemosButton"),
  deleteSelectedMemosButton: $("#deleteSelectedMemosButton"),
  clearMemoSelectionButton: $("#clearMemoSelectionButton"),
  accountLinkPanel: $("#accountLinkPanel"),
  accountLinkHint: $("#accountLinkHint"),
  passwordSetupBlock: $("#passwordSetupBlock"),
  googleLinkBlock: $("#googleLinkBlock"),
  accountPasswordInput: $("#accountPasswordInput"),
  accountPasswordStatus: $("#accountPasswordStatus"),
  accountPasswordConfirmInput: $("#accountPasswordConfirmInput"),
  accountPasswordConfirmStatus: $("#accountPasswordConfirmStatus"),
  setAccountPasswordButton: $("#setAccountPasswordButton"),
  googleLinkAccountLink: $("#googleLinkAccountLink"),
  sessionLabel: $("#sessionLabel"),
  searchInput: $("#searchInput"),
  folderIconInput: $("#folderIconInput"),
  folderNameInput: $("#folderNameInput"),
  createFolderButton: $("#createFolderButton"),
  tagFilterList: $("#tagFilterList"),
  clearTagFilterButton: $("#clearTagFilterButton"),
  memoList: $("#memoList"),
  newMemoButton: $("#newMemoButton"),
  settingsSyncButton: $("#settingsSyncButton"),
  settingsRebuildButton: $("#settingsRebuildButton"),
  settingsTrashButton: $("#settingsTrashButton"),
  installAppButton: $("#installAppButton"),
  settingsTutorialButton: $("#settingsTutorialButton"),
  settingsExportLink: $("#settingsExportLink"),
  guestBanner: $("#guestBanner"),
  networkBanner: $("#networkBanner"),
  guestLoginLink: $("#guestLoginLink"),
  guestRegisterLink: $("#guestRegisterLink"),
  recoveryBanner: $("#recoveryBanner"),
  loadAutosaveButton: $("#loadAutosaveButton"),
  discardAutosaveButton: $("#discardAutosaveButton"),
  titleInput: $("#titleInput"),
  folderPicker: $("#folderPicker"),
  folderPickerButton: $("#folderPickerButton"),
  folderPickerIcon: $("#folderPickerIcon"),
  folderPickerLabel: $("#folderPickerLabel"),
  folderPickerMenu: $("#folderPickerMenu"),
  tagsInput: $("#tagsInput"),
  startGuideAction: $("#startGuideAction"),
  startGuideTutorialLink: $("#startGuideTutorialLink"),
  contentInput: $("#contentInput"),
  commitMessageInput: $("#commitMessageInput"),
  imageInput: $("#imageInput"),
  textImportInput: $("#textImportInput"),
  textImportButton: $("#textImportButton"),
  imageButton: $("#imageButton"),
  historyButton: $("#historyButton"),
  editorModeButton: $("#editorModeButton"),
  saveButton: $("#saveButton"),
  toggleInspectorButton: $("#toggleInspectorButton"),
  closeInspectorButton: $("#closeInspectorButton"),
  inspectorResizeHandle: $("#inspectorResizeHandle"),
  statusLabel: $("#statusLabel"),
  updatedLabel: $("#updatedLabel"),
  previewTab: $("#previewTab"),
  historyTab: $("#historyTab"),
  previewPanel: $("#previewPanel"),
  historyPanel: $("#historyPanel"),
  preview: $("#preview"),
  inlinePreview: $("#inlinePreview"),
  historyList: $("#historyList"),
  accountDialog: $("#accountDialog"),
  settingsDialog: $("#settingsDialog"),
  commitDialog: $("#commitDialog"),
  downloadDialog: $("#downloadDialog"),
  unsavedDialog: $("#unsavedDialog"),
  historyDetailDialog: $("#historyDetailDialog"),
  historyDialog: $("#historyDialog"),
  trashDialog: $("#trashDialog"),
  closeCommitDialogButton: $("#closeCommitDialogButton"),
  cancelCommitButton: $("#cancelCommitButton"),
  confirmCommitButton: $("#confirmCommitButton"),
  closeDownloadDialogButton: $("#closeDownloadDialogButton"),
  cancelDownloadButton: $("#cancelDownloadButton"),
  confirmDownloadButton: $("#confirmDownloadButton"),
  saveUnsavedButton: $("#saveUnsavedButton"),
  discardUnsavedButton: $("#discardUnsavedButton"),
  closeHistoryDetailButton: $("#closeHistoryDetailButton"),
  historyDetailTitle: $("#historyDetailTitle"),
  historyDetailMeta: $("#historyDetailMeta"),
  historyRawTab: $("#historyRawTab"),
  historyDiffTab: $("#historyDiffTab"),
  historyRawPanel: $("#historyRawPanel"),
  historyDiffPanel: $("#historyDiffPanel"),
  historyRawContent: $("#historyRawContent"),
  historyDiffContent: $("#historyDiffContent"),
  closeHistoryDialogButton: $("#closeHistoryDialogButton"),
  historyDialogMeta: $("#historyDialogMeta"),
  floatingHistoryList: $("#floatingHistoryList"),
  closeTrashDialogButton: $("#closeTrashDialogButton"),
  trashDialogMeta: $("#trashDialogMeta"),
  trashList: $("#trashList"),
  closeAccountButton: $("#closeAccountButton"),
  closeSettingsButton: $("#closeSettingsButton"),
  accountEmail: $("#accountEmail"),
  autosaveToggle: $("#autosaveToggle"),
  authCard: $("#authCard"),
  loginModeButton: $("#loginModeButton"),
  registerModeButton: $("#registerModeButton"),
  authEmailInput: $("#authEmailInput"),
  authPasswordInput: $("#authPasswordInput"),
  authPasswordStatus: $("#authPasswordStatus"),
  authPasswordConfirmField: $("#authPasswordConfirmField"),
  authPasswordConfirmInput: $("#authPasswordConfirmInput"),
  authPasswordConfirmStatus: $("#authPasswordConfirmStatus"),
  authConsentGroup: $("#authConsentGroup"),
  termsConsentCheckbox: $("#termsConsentCheckbox"),
  privacyConsentCheckbox: $("#privacyConsentCheckbox"),
  ageConsentCheckbox: $("#ageConsentCheckbox"),
  authEmailStatus: $("#authEmailStatus"),
  authModeTitle: $("#authModeTitle"),
  authSwitchRegister: $("#authSwitchRegister"),
  authSwitchLogin: $("#authSwitchLogin"),
  passwordAuthButton: $("#passwordAuthButton"),
  logoutButton: $("#logoutButton"),
  showDeleteAccountButton: $("#showDeleteAccountButton"),
  deleteAccountPanel: $("#deleteAccountPanel"),
  deleteAccountEmailInput: $("#deleteAccountEmailInput"),
  deleteAccountPasswordInput: $("#deleteAccountPasswordInput"),
  cancelDeleteAccountButton: $("#cancelDeleteAccountButton"),
  confirmDeleteAccountButton: $("#confirmDeleteAccountButton"),
  logoutConfirmPanel: $("#logoutConfirmPanel"),
  cancelLogoutButton: $("#cancelLogoutButton"),
  confirmLogoutButton: $("#confirmLogoutButton"),
  authHint: $("#authHint"),
  accountSettingsContent: $("#accountSettingsContent"),
  settingsAccountCard: $("#settingsAccountCard"),
  settingsAccountInitial: $("#settingsAccountInitial"),
  settingsAccountTitle: $("#settingsAccountTitle"),
  settingsAccountSubtitle: $("#settingsAccountSubtitle"),
  settingsLoginButton: $("#settingsLoginButton"),
  settingsLogoutButton: $("#settingsLogoutButton"),
  dialogSystemThemeButton: $("#dialogSystemThemeButton"),
  dialogLightThemeButton: $("#dialogLightThemeButton"),
  dialogDarkThemeButton: $("#dialogDarkThemeButton"),
  mobileLayoutButton: $("#mobileLayoutButton"),
  desktopLayoutButton: $("#desktopLayoutButton"),
  orientationLockSetting: $("#orientationLockSetting"),
  orientationLockToggle: $("#orientationLockToggle"),
  githubRepoInput: $("#githubRepoInput"),
  githubTokenInput: $("#githubTokenInput"),
  storageUsage: $("#storageUsage"),
  saveSettingsButton: $("#saveSettingsButton"),
  googleLoginLink: $("#googleLoginLink"),
  tutorialOverlay: $("#tutorialOverlay"),
  tutorialCard: $("#tutorialCard"),
  tutorialSpotlight: $("#tutorialSpotlight"),
  tutorialTitle: $("#tutorialTitle"),
  tutorialText: $("#tutorialText"),
  tutorialStepLabel: $("#tutorialStepLabel"),
  tutorialPrevButton: $("#tutorialPrevButton"),
  tutorialNextButton: $("#tutorialNextButton"),
  tutorialCloseButton: $("#tutorialCloseButton"),
  appTooltip: $("#appTooltip")
};

init();

async function init() {
  configurePreviewRenderer();
  applyTheme();
  applyLayout();
  setEditorMode(state.editorMode);
  syncResponsiveLayout();
  bindEvents();
  bindPwaInstall();
  bindTooltips();
  bindInspectorResize();
  registerServiceWorker();
  bindOrientationLock();
  bindNetworkStatus();
  await loadSession();
  await bootWorkspace({ skipRoute: true });
  await applyInitialRoute();
  showAuthCallbackMessage();
}

function showAuthCallbackMessage() {
  const params = new URLSearchParams(window.location.search);
  const message = params.get("auth_error");
  if (!message) return;
  setStatus(message);
  params.delete("auth_error");
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );
}

function parseLocationRoute() {
  const parts = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (!parts.length) return { page: "list", memoId: "" };
  if (parts[0] === "settings") return { page: "settings", memoId: "" };
  if (parts[0] === "login") return { page: "login", memoId: "" };
  if (parts[0] === "trash") return { page: "trash", memoId: "" };
  if (parts[0] === "memos" || parts[0] === "memo-list") {
    return parts[1]
      ? { page: "editor", memoId: parts[1] }
      : { page: "list", memoId: "" };
  }
  return { page: "editor", memoId: parts[0] };
}

function pathForRoute(route) {
  if (route.page === "settings") return "/settings";
  if (route.page === "login") return "/login";
  if (route.page === "trash") return "/trash";
  if (route.page === "editor" && route.memoId) return `/memos/${encodeURIComponent(route.memoId)}`;
  return "/memos";
}

function writeRoute(route, { replace = false } = {}) {
  const path = pathForRoute(route);
  if (window.location.pathname !== path) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ route }, "", path);
  } else {
    window.history.replaceState({ route }, "", path);
  }
  state.route = route;
  applyRouteChrome(route);
}

async function applyInitialRoute() {
  const route = parseLocationRoute();
  writeRoute(route, { replace: true });
  await applyRoute(route);
}

async function applyRouteFromLocation() {
  const route = parseLocationRoute();
  if (shouldPromptForUnsaved(route) && !(await confirmBeforeLeavingDirty())) {
    writeRoute(state.route, { replace: true });
    return;
  }
  await applyRoute(route);
}

async function navigateToRoute(route, { replace = false } = {}) {
  if (shouldPromptForUnsaved(route) && !(await confirmBeforeLeavingDirty())) return false;
  writeRoute(route, { replace });
  await applyRoute(route);
  return true;
}

async function navigateToList() {
  if (await navigateToRoute({ page: "list", memoId: "" })) clearMemoSelection();
}

function navigateToMemo(id, options = {}) {
  if (!id) return;
  navigateToRoute({ page: "editor", memoId: id }, options);
}

function shouldPromptForUnsaved(route) {
  if (!state.dirty || !state.current) return false;
  if (route.page === "editor" && route.memoId === state.current.id) return false;
  return true;
}

async function applyRoute(route) {
  state.isApplyingRoute = true;
  state.route = route;
  applyRouteChrome(route);

  try {
    if (route.page === "list") {
      closeRouteDialogs();
      clearMemoSelection();
      return;
    }

    if (route.page === "settings") {
      if (elements.accountDialog.open) elements.accountDialog.close();
      await openSettingsDialog({ skipRoute: true });
      return;
    }

    if (route.page === "login") {
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      if (elements.trashDialog.open) elements.trashDialog.close();
      await openAccountDialog(state.authMode, { skipRoute: true });
      return;
    }

    if (route.page === "trash") {
      if (elements.accountDialog.open) elements.accountDialog.close();
      if (elements.settingsDialog.open) elements.settingsDialog.close();
      await openTrashDialog({ skipRoute: true });
      return;
    }

    closeRouteDialogs();
    if (route.memoId && state.current?.id !== route.memoId) {
      await openMemo(route.memoId, { skipRoute: true });
    }
  } catch (error) {
    setStatus(error.message || "화면을 열 수 없습니다.");
    if (route.page === "editor") writeRoute({ page: "list", memoId: "" }, { replace: true });
  } finally {
    state.isApplyingRoute = false;
    renderMobileChrome();
  }
}

function applyRouteChrome(route = state.route) {
  elements.appShell.classList.toggle("page-list", route.page === "list");
  elements.appShell.classList.toggle("page-editor", route.page === "editor");
  elements.appShell.classList.toggle("page-settings", route.page === "settings");
  elements.appShell.classList.toggle("page-login", route.page === "login");
  elements.appShell.classList.toggle("page-trash", route.page === "trash");
  document.body.classList.toggle("page-list", route.page === "list");
  document.body.classList.toggle("page-editor", route.page === "editor");
  document.body.classList.toggle("page-settings", route.page === "settings");
  document.body.classList.toggle("page-login", route.page === "login");
  document.body.classList.toggle("page-trash", route.page === "trash");

  if (route.page === "list") {
    state.sidebarCollapsed = false;
  } else {
    state.sidebarCollapsed = true;
  }
  state.inspectorCollapsed = true;
  applyLayout();
}

function closeRouteDialogs() {
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  if (elements.accountDialog.open) elements.accountDialog.close();
  if (elements.trashDialog.open) elements.trashDialog.close();
}

function closeSettingsRoute() {
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  navigateToRoute({ page: "list", memoId: "" }, { replace: true });
}

function closeAccountRoute() {
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.accountDialog.open) elements.accountDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  navigateToRoute({ page: "list", memoId: "" }, { replace: true });
}

function closeTrashRoute() {
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.trashDialog.open) elements.trashDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  navigateToRoute({ page: "settings", memoId: "" }, { replace: true });
}

function handleRouteDialogClose(event) {
  renderMobileChrome();
  if (state.isApplyingRoute) return;
  const closedSettingsRoute = event?.target === elements.settingsDialog && state.route.page === "settings";
  const closedLoginRoute = event?.target === elements.accountDialog && state.route.page === "login";
  const closedTrashRoute = event?.target === elements.trashDialog && state.route.page === "trash";
  if (closedSettingsRoute || closedLoginRoute) {
    navigateToRoute({ page: "list", memoId: "" }, { replace: true });
  } else if (closedTrashRoute) {
    navigateToRoute({ page: "settings", memoId: "" }, { replace: true });
  }
}

function bindEvents() {
  elements.mobileMenuButton.addEventListener("click", navigateToList);
  elements.editorBackButton.addEventListener("click", navigateToList);
  elements.mobileTitleButton.addEventListener("click", navigateToList);
  elements.mobileSearchButton.addEventListener("click", () => {
    navigateToList();
    window.setTimeout(() => {
      elements.searchInput.focus();
      elements.searchInput.select();
    }, 120);
  });
  elements.mobileNewMemoButton.addEventListener("click", () => {
    createMemo();
  });
  elements.mobileNotesTab.addEventListener("click", navigateToList);
  elements.mobileWriteTab.addEventListener("click", () => {
    if (state.current) navigateToMemo(state.current.id);
    setEditorMode("source");
    elements.contentInput.focus();
  });
  elements.mobileViewTab.addEventListener("click", () => {
    if (state.current) navigateToMemo(state.current.id);
    setEditorMode("preview");
  });
  elements.mobileAccountTab.addEventListener("click", openSettingsDialog);
  elements.mobileSettingsTab.addEventListener("click", openSettingsDialog);
  elements.sidebarToggleButton.addEventListener("click", () => {
    setSidebarCollapsed(!state.sidebarCollapsed);
  });
  elements.railNewMemoButton.addEventListener("click", () => {
    createMemo();
  });
  elements.railSearchButton.addEventListener("click", () => {
    setSidebarCollapsed(false);
    elements.searchInput.focus();
    elements.searchInput.select();
  });
  elements.railRecentButton.addEventListener("click", () => {
    if (state.memos[0]) openMemo(state.memos[0].id);
  });
  elements.railSettingsButton.addEventListener("click", openSettingsDialog);
  elements.settingsButton.addEventListener("click", openSettingsDialog);
  elements.accountButton.addEventListener("click", openSettingsDialog);
  elements.accountSummaryButton.addEventListener("click", openSettingsDialog);

  elements.searchInput.addEventListener("input", debounce(loadMemos, 180));
  elements.newMemoButton.addEventListener("click", () => {
    createMemo();
  });
  elements.pinSelectedMemosButton.addEventListener("click", pinSelectedMemos);
  elements.restoreSelectedMemosButton.addEventListener("click", restoreSelectedMemos);
  elements.deleteSelectedMemosButton.addEventListener("click", deleteSelectedMemos);
  elements.clearMemoSelectionButton.addEventListener("click", clearMemoSelection);
  elements.clearTagFilterButton.addEventListener("click", () => {
    state.activeTag = "";
    loadMemos();
  });
  elements.createFolderButton.addEventListener("click", createFolderFromInput);
  elements.folderNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createFolderFromInput();
    }
  });
  elements.folderIconInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createFolderFromInput();
    }
  });
  elements.folderPickerButton.addEventListener("click", toggleFolderPicker);
  document.addEventListener("pointerdown", (event) => {
    if (!elements.folderPicker.contains(event.target)) closeFolderPicker();
  });
  document.addEventListener("pointerdown", handleMobileChromeOutsidePointerDown);
  window.addEventListener("resize", syncResponsiveLayout);
  elements.dialogSystemThemeButton.addEventListener("click", () => setThemePreference("system"));
  elements.dialogLightThemeButton.addEventListener("click", () => setThemePreference("light"));
  elements.dialogDarkThemeButton.addEventListener("click", () => setThemePreference("dark"));
  elements.mobileLayoutButton.addEventListener("click", () => setUiPreference("mobile"));
  elements.desktopLayoutButton.addEventListener("click", () => setUiPreference("desktop"));
  elements.orientationLockToggle.addEventListener("change", () => {
    setOrientationLockPreference(elements.orientationLockToggle.checked ? "on" : "off");
  });
  elements.loginModeButton.addEventListener("click", () => setAuthMode("login"));
  elements.registerModeButton.addEventListener("click", () => setAuthMode("register"));
  elements.guestLoginLink.addEventListener("click", () => openAccountDialog("login"));
  elements.guestRegisterLink.addEventListener("click", () => openAccountDialog("register"));
  elements.authEmailInput.addEventListener("input", () => updateAuthValidation({ checkEmail: true }));
  elements.authPasswordInput.addEventListener("input", updateAuthValidation);
  elements.authPasswordConfirmInput.addEventListener("input", updateAuthValidation);
  for (const checkbox of [
    elements.termsConsentCheckbox,
    elements.privacyConsentCheckbox,
    elements.ageConsentCheckbox
  ]) {
    checkbox.addEventListener("change", updateAuthValidation);
  }
  elements.passwordAuthButton.addEventListener("click", submitPasswordAuth);
  elements.accountPasswordInput.addEventListener("input", updateAccountPasswordValidation);
  elements.accountPasswordConfirmInput.addEventListener("input", updateAccountPasswordValidation);
  elements.setAccountPasswordButton.addEventListener("click", submitAccountPassword);
  elements.logoutButton.addEventListener("click", showLogoutConfirmPanel);
  elements.cancelLogoutButton.addEventListener("click", hideLogoutConfirmPanel);
  elements.confirmLogoutButton.addEventListener("click", logout);
  elements.showDeleteAccountButton.addEventListener("click", showDeleteAccountPanel);
  elements.cancelDeleteAccountButton.addEventListener("click", hideDeleteAccountPanel);
  elements.confirmDeleteAccountButton.addEventListener("click", deleteAccount);
  for (const input of [elements.authEmailInput, elements.authPasswordInput, elements.authPasswordConfirmInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitPasswordAuth();
      }
    });
  }
  for (const input of [elements.accountPasswordInput, elements.accountPasswordConfirmInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitAccountPassword();
      }
    });
  }
  elements.settingsSyncButton.addEventListener("click", syncGithub);
  elements.settingsRebuildButton.addEventListener("click", rebuildIndex);
  elements.settingsTrashButton.addEventListener("click", () => openTrashDialog());
  elements.installAppButton.addEventListener("click", installPwa);
  elements.settingsTutorialButton.addEventListener("click", () => startTutorial());
  elements.settingsLoginButton.addEventListener("click", () => openAccountDialog("login"));
  elements.settingsLogoutButton.addEventListener("click", () => {
    if (window.confirm("정말 로그아웃 하시겠습니까?")) logout();
  });
  elements.settingsExportLink.addEventListener("click", (event) => {
    if (state.authenticated) return;
    event.preventDefault();
    openAccountDialog("login");
    setStatus("ZIP 내보내기는 로그인 후 사용할 수 있습니다.");
  });
  elements.saveButton.addEventListener("click", requestSaveCurrentMemo);
  elements.closeCommitDialogButton.addEventListener("click", closeCommitDialog);
  elements.cancelCommitButton.addEventListener("click", closeCommitDialog);
  elements.confirmCommitButton.addEventListener("click", confirmCommitSave);
  elements.closeDownloadDialogButton.addEventListener("click", closeDownloadDialog);
  elements.cancelDownloadButton.addEventListener("click", closeDownloadDialog);
  elements.confirmDownloadButton.addEventListener("click", confirmDownloadSave);
  elements.saveUnsavedButton.addEventListener("click", saveUnsavedAndContinue);
  elements.discardUnsavedButton.addEventListener("click", discardUnsavedAndContinue);
  elements.unsavedDialog.addEventListener("cancel", (event) => event.preventDefault());
  elements.commitDialog.addEventListener("cancel", () => finishPendingSave(false));
  elements.downloadDialog.addEventListener("cancel", () => finishPendingSave(false));
  elements.closeHistoryDetailButton.addEventListener("click", closeHistoryDetailDialog);
  elements.closeHistoryDialogButton.addEventListener("click", () => elements.historyDialog.close());
  elements.closeTrashDialogButton.addEventListener("click", closeTrashRoute);
  elements.historyRawTab.addEventListener("click", () => setHistoryDetailMode("raw"));
  elements.historyDiffTab.addEventListener("click", () => setHistoryDetailMode("diff"));
  elements.commitMessageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmCommitSave();
    }
  });
  elements.imageButton.addEventListener("click", () => elements.imageInput.click());
  elements.historyButton.addEventListener("click", openHistoryDialog);
  elements.editorModeButton.addEventListener("click", () => {
    setEditorMode(state.editorMode === "source" ? "preview" : "source");
  });
  elements.imageInput.addEventListener("change", uploadSelectedImage);
  elements.textImportButton.addEventListener("click", () => elements.textImportInput.click());
  elements.textImportInput.addEventListener("change", importSelectedTextFiles);
  elements.startGuideTutorialLink.addEventListener("click", (event) => {
    event.preventDefault();
    startTutorial();
  });
  elements.loadAutosaveButton.addEventListener("click", loadAutosaveIntoEditor);
  elements.discardAutosaveButton.addEventListener("click", discardAutosave);
  elements.previewTab.addEventListener("click", () => setPanel("preview"));
  elements.historyTab.addEventListener("click", () => setPanel("history"));
  elements.toggleInspectorButton.addEventListener("click", () => {
    setInspectorCollapsed(!state.inspectorCollapsed);
  });
  elements.closeInspectorButton.addEventListener("click", () => {
    setInspectorCollapsed(true);
  });
  elements.saveSettingsButton.addEventListener("click", saveSettings);
  elements.closeAccountButton.addEventListener("click", closeAccountRoute);
  elements.closeSettingsButton.addEventListener("click", closeSettingsRoute);
  elements.accountDialog.addEventListener("close", handleRouteDialogClose);
  elements.settingsDialog.addEventListener("close", handleRouteDialogClose);
  elements.trashDialog.addEventListener("close", handleRouteDialogClose);
  elements.historyDialog.addEventListener("close", renderMobileChrome);
  elements.googleLoginLink.addEventListener("click", (event) => {
    if (!state.capabilities.google_oauth) {
      event.preventDefault();
      setStatus("Google OAuth 환경변수 필요");
      return;
    }
    if (state.authMode === "register" && !registrationConsentReady()) {
      event.preventDefault();
      setStatus("Google 회원가입 전 필수 약관 동의와 만 14세 이상 확인이 필요합니다.");
    }
  });
  elements.googleLinkAccountLink.addEventListener("click", (event) => {
    if (!state.capabilities.google_oauth) {
      event.preventDefault();
      setStatus("Google OAuth 환경변수 필요");
    }
  });

  for (const input of [elements.titleInput, elements.tagsInput, elements.contentInput]) {
    input.addEventListener("input", markEditorDirty);
  }

  elements.contentInput.addEventListener("paste", handlePaste);
  elements.contentInput.addEventListener("focus", enterMobileWritingMode);
  elements.titleInput.addEventListener("focus", enterMobileWritingMode);
  elements.tagsInput.addEventListener("focus", enterMobileWritingMode);
  for (const input of [elements.titleInput, elements.tagsInput, elements.contentInput]) {
    input.addEventListener("blur", leaveMobileWritingModeSoon);
  }
  elements.contentInput.addEventListener("click", maybeRunEditorLink);
  elements.preview.addEventListener("click", handlePreviewClick);
  elements.inlinePreview.addEventListener("click", handlePreviewClick);
  bindFileDrop();
  bindTutorial();
  window.addEventListener("popstate", applyRouteFromLocation);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("keydown", (event) => {
    if ((event.key === "Escape" || event.key === "Enter") && handleSelectionExitKey(event)) {
      event.preventDefault();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      requestSaveCurrentMemo();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      setSidebarCollapsed(!state.sidebarCollapsed);
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.themePreference === "system") applyTheme();
  });
}

function handleSelectionExitKey(event) {
  if (event.key === "Enter" && isTextEntryTarget(event.target)) return false;
  return handleEscapeKey();
}

function handleEscapeKey() {
  if (isBlockingDialogOpen()) return false;

  if (state.drag) {
    cancelDrag(state.drag);
    clearMemoSelection();
    setStatus("선택 해제됨");
    return true;
  }

  if (state.selectedMemoIds.size) {
    clearMemoSelection();
    setStatus("선택 해제됨");
    return true;
  }

  return false;
}

function isBlockingDialogOpen() {
  const dialogs = [
    elements.accountDialog,
    elements.settingsDialog,
    elements.commitDialog,
    elements.downloadDialog,
    elements.unsavedDialog,
    elements.historyDetailDialog,
    elements.historyDialog,
    elements.trashDialog
  ];
  return dialogs.some((dialog) => dialog?.open)
    || !elements.tutorialOverlay.classList.contains("hidden");
}

function isTextEntryTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function bindFileDrop() {
  let dragDepth = 0;

  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const showDropState = () => elements.editorPane.classList.add("file-drop-active");
  const hideDropState = () => {
    dragDepth = 0;
    elements.editorPane.classList.remove("file-drop-active");
  };

  elements.editorPane.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    showDropState();
  });

  elements.editorPane.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropState();
  });

  elements.editorPane.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) hideDropState();
  });

  elements.editorPane.addEventListener("drop", async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    hideDropState();
    await handleDroppedFiles(files);
  });
}

function bindPwaInstall() {
  renderInstallButton();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    state.pwaInstalled = false;
    renderInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    state.pwaInstalled = true;
    lockAppOrientation();
    renderInstallButton();
    setStatus("ChronoNote 앱 설치됨");
  });
}

function bindOrientationLock() {
  syncOrientationLock();
  window.addEventListener("pageshow", lockAppOrientation);
  window.addEventListener("focus", lockAppOrientation);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lockAppOrientation();
  });
  window.addEventListener("resize", syncOrientationLock);
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", lockAppOrientation);
}

function bindNetworkStatus() {
  const update = () => {
    const wasOnline = state.online;
    state.online = navigator.onLine;
    elements.networkBanner.classList.toggle("hidden", state.online);
    if (!wasOnline && state.online) {
      setStatus("연결이 복구되었습니다.");
      if (state.dirty) scheduleAutosave();
    }
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

async function lockAppOrientation() {
  if (!shouldLockOrientation()) {
    unlockAppOrientation();
    return false;
  }
  if (!screen.orientation?.lock) return false;
  try {
    await screen.orientation.lock("portrait-primary");
    return true;
  } catch {
    return false;
  }
}

function unlockAppOrientation() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Some browsers expose lock() without allowing unlock() in normal tabs.
  }
}

function syncOrientationLock() {
  renderOrientationLockSetting();
  lockAppOrientation();
}

function shouldLockOrientation() {
  return isOrientationLockEnabled() && isTouchViewport();
}

function isOrientationLockEnabled() {
  if (state.orientationLockPreference === "on") return true;
  if (state.orientationLockPreference === "off") return false;
  return isPhoneViewport();
}

function setOrientationLockPreference(preference) {
  state.orientationLockPreference = preference === "on" ? "on" : "off";
  localStorage.setItem("chrononote.orientationLock", state.orientationLockPreference);
  syncOrientationLock();
  setStatus(isOrientationLockEnabled() ? "화면 회전 잠금 켜짐" : "화면 회전 잠금 꺼짐");
}

function renderOrientationLockSetting() {
  if (!elements.orientationLockSetting || !elements.orientationLockToggle) return;
  const visible = isTouchViewport();
  elements.orientationLockSetting.classList.toggle("hidden", !visible);
  elements.orientationLockToggle.checked = isOrientationLockEnabled();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    renderInstallButton();
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    renderInstallButton();
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function installPwa() {
  if (state.pwaInstalled || isStandaloneDisplay()) {
    state.pwaInstalled = true;
    renderInstallButton();
    setStatus("이미 앱으로 실행 중입니다.");
    return;
  }

  const promptEvent = state.deferredInstallPrompt;
  if (!promptEvent) {
    setStatus("브라우저 메뉴의 홈 화면에 추가 또는 앱 설치를 사용해주세요.");
    renderInstallButton();
    return;
  }

  state.deferredInstallPrompt = null;
  promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
  state.pwaInstalled = choice?.outcome === "accepted" || isStandaloneDisplay();
  if (state.pwaInstalled) await lockAppOrientation();
  renderInstallButton();
  setStatus(state.pwaInstalled ? "ChronoNote 앱 설치됨" : "앱 설치가 취소됨");
}

function renderInstallButton() {
  if (!elements.installAppButton) return;
  const installed = state.pwaInstalled || isStandaloneDisplay();
  elements.installAppButton.disabled = installed;
  elements.installAppButton.classList.toggle("installed", installed);
  elements.installAppButton.textContent = installed
    ? "앱 설치됨"
    : state.deferredInstallPrompt
      ? "앱 설치"
      : "앱 설치";
}

function isStandaloneDisplay() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isTouchViewport() {
  return window.matchMedia?.("(pointer: coarse)")?.matches || navigator.maxTouchPoints > 0;
}

function isPhoneViewport() {
  const narrowTouch = window.matchMedia?.("(pointer: coarse) and (max-width: 680px)")?.matches;
  const shortTouch = window.matchMedia?.("(pointer: coarse) and (max-height: 680px)")?.matches;
  return Boolean(narrowTouch || shortTouch);
}

async function loadSession() {
  const session = await api("/api/session");
  state.user = session.user || null;
  state.authenticated = Boolean(session.authenticated && session.user);
  state.csrfToken = session.csrf_token || null;
  state.capabilities = session.capabilities || {};
  state.themePreference = state.user?.theme_preference || state.themePreference || "system";
  localStorage.setItem("chrononote.themePreference", state.themePreference);
  applyTheme();
  renderUser();
  renderGuestBanner();
}

async function bootWorkspace({ skipRoute = false } = {}) {
  await loadMemos();
  const activeMemos = state.memos.filter((memo) => !isTrashedMemo(memo));
  const currentStillVisible = state.current && activeMemos.some((memo) => memo.id === state.current.id);
  if (currentStillVisible) {
    await openMemo(state.current.id, { skipRoute });
  } else if (activeMemos[0]) {
    await openMemo(activeMemos[0].id, { skipRoute });
  } else {
    await createMemo({ skipRoute });
  }
  if (!skipRoute && isMobileLayout()) navigateToList();
}

function renderUser() {
  if (!state.authenticated) {
    renderLoggedOutUser();
    return;
  }

  const email = state.user?.email || "";
  const initial = email.slice(0, 1).toUpperCase();

  elements.sessionLabel.textContent = email;
  elements.accountEmail.textContent = email;
  elements.accountButton.textContent = initial;
  elements.accountInitial.textContent = initial;
  elements.accountSummaryEmail.textContent = email;
  elements.settingsAccountInitial.textContent = initial;
  elements.settingsAccountTitle.textContent = email || "계정";
  elements.settingsAccountSubtitle.textContent = providerLabel(state.user).label;
  elements.settingsLoginButton.classList.add("hidden");
  elements.settingsLogoutButton.classList.remove("hidden");
  const provider = providerLabel(state.user);
  elements.accountProviderBadge.textContent = provider.badge;
  elements.accountProviderLabel.textContent = provider.label;
  elements.accountUserId.textContent = state.user?.id ? `workspace ${state.user.id}` : "workspace";
  elements.accountProviderBadge.classList.remove("login-badge");
  elements.accountSummaryButton.classList.remove("login-summary");
  elements.accountButton.classList.remove("login-chip");
  elements.autosaveToggle.checked = Boolean(state.user?.is_autosave_enabled);
  elements.githubRepoInput.value = state.user?.github_sync_repo || "";
  elements.githubTokenInput.placeholder = state.user?.has_github_sync_token
    ? "저장된 토큰 있음, 새 토큰 입력 시 교체"
    : "GitHub PAT";
  elements.googleLoginLink.classList.toggle("disabled", !state.capabilities.google_oauth);
  elements.googleLoginLink.setAttribute("aria-disabled", state.capabilities.google_oauth ? "false" : "true");
  elements.authHint.textContent = state.capabilities.google_oauth
    ? "Google 로그인은 별도 사용자 작업공간을 만들거나 기존 Google 계정 작업공간으로 이동합니다."
    : "Google OAuth 환경변수를 설정하면 Google 로그인이 활성화됩니다.";
  setAuthMode(state.authMode);
  renderAccountDialogMode();
  renderAccountLinkPanel();
  renderThemeButtons();
}

function renderLoggedOutUser() {
  elements.sessionLabel.textContent = "체험 모드";
  elements.accountEmail.textContent = "로그인하면 서버 저장과 동기화를 사용할 수 있습니다.";
  elements.accountButton.textContent = "G";
  elements.accountInitial.textContent = "G";
  elements.accountSummaryEmail.textContent = "게스트";
  elements.settingsAccountInitial.textContent = "G";
  elements.settingsAccountTitle.textContent = "체험 모드";
  elements.settingsAccountSubtitle.textContent = "로그인하면 서버 저장과 동기화를 사용할 수 있습니다.";
  elements.settingsLoginButton.classList.remove("hidden");
  elements.settingsLogoutButton.classList.add("hidden");
  elements.accountProviderBadge.textContent = "G";
  elements.accountProviderLabel.textContent = "체험 모드";
  elements.accountUserId.textContent = "일부 저장·동기화 기능은 로그인 후 사용할 수 있습니다";
  elements.accountProviderBadge.classList.add("login-badge");
  elements.accountSummaryButton.classList.remove("login-summary");
  elements.accountButton.classList.remove("login-chip");
  elements.githubRepoInput.value = "";
  elements.githubTokenInput.value = "";
  elements.autosaveToggle.checked = false;
  elements.googleLoginLink.classList.toggle("disabled", !state.capabilities.google_oauth);
  elements.googleLoginLink.setAttribute("aria-disabled", state.capabilities.google_oauth ? "false" : "true");
  elements.authHint.textContent = state.capabilities.google_oauth
    ? "로그인하거나 새 계정을 만들면 개인 작업공간이 열립니다."
    : "Google OAuth 환경변수를 설정하면 Google 로그인이 활성화됩니다.";
  setAuthMode(state.authMode);
  renderAccountDialogMode();
  renderAccountLinkPanel();
  renderThemeButtons();
}

function renderAccountDialogMode() {
  const loggedIn = state.authenticated;
  document.body.classList.toggle("is-logged-out", !loggedIn);
  elements.accountDialog.classList.toggle("logged-out", !loggedIn);
  elements.accountDialog.classList.toggle("logged-in", loggedIn);
  elements.authCard.classList.toggle("hidden", loggedIn);
  elements.accountSettingsContent.classList.remove("hidden");
  elements.logoutButton.classList.toggle("hidden", !loggedIn);
  elements.showDeleteAccountButton.classList.toggle("hidden", !loggedIn || !state.user?.has_password);
  for (const control of [
    elements.autosaveToggle,
    elements.githubRepoInput,
    elements.githubTokenInput,
    elements.saveSettingsButton,
    elements.settingsSyncButton,
    elements.settingsRebuildButton
  ]) {
    control.disabled = !loggedIn;
  }
  elements.settingsExportLink.classList.toggle("disabled", !loggedIn);
  elements.settingsExportLink.setAttribute("aria-disabled", loggedIn ? "false" : "true");
  elements.authEmailInput.value = loggedIn ? "" : elements.authEmailInput.value;
  if (!loggedIn) {
    hideDeleteAccountPanel();
    hideLogoutConfirmPanel();
    clearAccountPasswordFields();
  }
  if (loggedIn) elements.authHint.textContent = "로그아웃하거나 계정 정보를 확인할 수 있습니다.";
  renderAccountLinkPanel();
}

function renderAccountLinkPanel() {
  const loggedIn = state.authenticated;
  const hasPassword = Boolean(state.user?.has_password);
  const hasGoogle = Boolean(state.user?.has_google || state.user?.google_id);
  const showPasswordSetup = loggedIn && !hasPassword;
  const showGoogleLink = loggedIn && !hasGoogle;

  elements.accountLinkPanel.classList.toggle("hidden", !loggedIn || (!showPasswordSetup && !showGoogleLink));
  elements.passwordSetupBlock.classList.toggle("hidden", !showPasswordSetup);
  elements.googleLinkBlock.classList.toggle("hidden", !showGoogleLink);
  elements.googleLinkAccountLink.classList.toggle("disabled", !state.capabilities.google_oauth);
  elements.googleLinkAccountLink.setAttribute("aria-disabled", state.capabilities.google_oauth ? "false" : "true");

  if (!loggedIn) return;
  if (showPasswordSetup && showGoogleLink) {
    elements.accountLinkHint.textContent = "비밀번호와 Google 로그인을 추가해 같은 작업공간을 여러 방식으로 열 수 있습니다.";
  } else if (showPasswordSetup) {
    elements.accountLinkHint.textContent = "비밀번호를 등록하면 Google 없이도 이메일 로그인을 사용할 수 있습니다.";
  } else if (showGoogleLink) {
    elements.accountLinkHint.textContent = "Google을 연동하면 같은 이메일 계정을 Google 로그인으로도 열 수 있습니다.";
  }

  updateAccountPasswordValidation();
}

function providerLabel(user) {
  if (user?.has_google && user?.has_password) {
    return { badge: "G+", label: "Google + 이메일 계정" };
  }
  if (user?.auth_provider === "google") {
    return { badge: "G", label: "Google 계정" };
  }
  if (user?.auth_provider === "password") {
    return { badge: "@", label: "이메일 계정" };
  }
  return { badge: "L", label: "로컬 개발 계정" };
}

function renderLoggedOutWorkspace() {
  loadGuestMemos();
  const currentIsGuest = state.current && state.guestMemos.some((memo) => memo.id === state.current.id);
  const firstActive = state.guestMemos.find((memo) => !isTrashedMemo(memo));
  const nextId = currentIsGuest && !isTrashedMemo(state.current) ? state.current.id : firstActive?.id;
  if (nextId) openMemo(nextId);
  setStatus("체험 모드");
}

function setWorkspaceEnabled(enabled) {
  for (const element of [
    elements.searchInput,
    elements.folderIconInput,
    elements.folderNameInput,
    elements.createFolderButton,
    elements.newMemoButton,
    elements.titleInput,
    elements.folderPickerButton,
    elements.tagsInput,
    elements.contentInput,
    elements.commitMessageInput,
    elements.textImportButton,
    elements.imageButton,
    elements.saveButton
  ]) {
    element.disabled = !enabled;
  }
}

function requireLogin() {
  if (state.authenticated) return true;
  openAccountDialog("login");
  setStatus("로그인이 필요합니다.");
  return false;
}

async function loadMemos() {
  if (!state.authenticated) {
    loadGuestMemos();
    return;
  }
  renderGuestBanner();
  setWorkspaceEnabled(true);

  const search = elements.searchInput.value.trim();
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (state.activeTag) query.set("tag", state.activeTag);
  const [memoData, folderData, tagData] = await Promise.all([
    api(`/api/memos?${query.toString()}`),
    api("/api/folders"),
    api("/api/tags")
  ]);
  state.memos = memoData.memos;
  state.folders = folderData.folders;
  state.tags = tagData.tags;
  renderFolderPicker(state.current?.folder ?? state.selectedFolder);
  renderTagFilters();
  renderMemoList();
}

async function loadMemosForTrashView() {
  if (!state.authenticated) {
    ensureGuestData();
    purgeExpiredGuestTrash();
    state.folders = buildGuestFolders();
    state.tags = buildGuestTags();
    state.memos = state.guestMemos.map((memo) => ({ ...memo, excerpt: memoExcerpt(memo.content) }));
    renderFolderPicker(state.current?.folder ?? state.selectedFolder);
    renderTagFilters();
    renderMemoList();
    return;
  }

  const [memoData, folderData, tagData] = await Promise.all([
    api("/api/memos"),
    api("/api/folders"),
    api("/api/tags")
  ]);
  state.memos = memoData.memos;
  state.folders = folderData.folders;
  state.tags = tagData.tags;
  renderFolderPicker(state.current?.folder ?? state.selectedFolder);
  renderTagFilters();
  renderMemoList();
}

function loadGuestMemos() {
  ensureGuestData();
  setWorkspaceEnabled(true);
  renderGuestBanner();

  const search = elements.searchInput.value.trim().toLowerCase();
  state.folders = buildGuestFolders();
  state.tags = buildGuestTags();
  state.memos = state.guestMemos
    .filter((memo) => {
      if (state.activeTag && !(memo.tags || []).includes(state.activeTag)) return false;
      if (!search) return true;
      return [
        memo.title,
        memo.folder,
        memo.content,
        ...(memo.tags || [])
      ].some((value) => String(value || "").toLowerCase().includes(search));
    })
    .map((memo) => ({ ...memo, excerpt: memoExcerpt(memo.content) }));

  renderFolderPicker(state.current?.folder ?? state.selectedFolder);
  renderTagFilters();
  renderMemoList();
}

function renderGuestBanner() {
  elements.guestBanner.classList.toggle("hidden", state.authenticated);
}

function ensureGuestData() {
  if (!state.guestFolders.length) {
    state.guestFolders = [
      {
        name: "",
        label: "기본 폴더",
        icon: "📁",
        position: 0,
        memo_count: 0
      },
      {
        name: TRASH_FOLDER_NAME,
        label: TRASH_FOLDER_NAME,
        icon: TRASH_FOLDER_ICON,
        position: 1,
        memo_count: 0
      }
    ];
  }

  if (!state.guestMemos.length) {
    const now = new Date().toISOString();
    state.guestMemos = [{
      id: "guest-guide",
      title: "ChronoNote 시작 가이드",
      folder: "",
      tags: ["guide", "guest"],
      pinned: true,
      position: 1,
      created_at: now,
      updated_at: now,
      content: [
        "# ChronoNote 시작 가이드",
        "",
        "> 로그인하지 않은 상태에서는 서버에 저장되지 않습니다.",
        "",
        "처음이라면 작성창 위의 튜토리얼 시작하기 링크를 눌러 기능을 빠르게 둘러보세요.",
        "",
        "지금은 체험 모드입니다. 메모 작성, 폴더 지정, 태그, 고정, 드래그 정렬, 이미지 삽입, HTML, LaTeX 수식, 움짤 첨부를 먼저 써볼 수 있습니다.",
        "",
        "- 저장 버튼이나 Ctrl+S를 누르면 이 메모가 `.md` 파일로 다운로드됩니다.",
        "- 서버 저장, Git 히스토리, ZIP 내보내기, GitHub 동기화는 로그인 후 사용할 수 있습니다.",
        "- 왼쪽 아래 계정 칸이나 안내바 링크에서 회원가입 또는 로그인을 할 수 있습니다.",
        "- 튜토리얼은 나중에 설정에서도 다시 열 수 있습니다.",
        "",
        "수식 예시: $E = mc^2$",
        "",
        "<style>",
        ".chrono-html-demo { border: 1px solid color-mix(in srgb, var(--teal) 42%, var(--line)); border-radius: 12px; padding: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 82%, var(--teal-soft)), color-mix(in srgb, var(--surface) 86%, var(--berry-soft))); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--surface-strong) 70%, transparent); }",
        ".chrono-html-demo code { color: var(--berry); }",
        ".chrono-html-demo .metric { display: inline-grid; margin-top: 10px; padding: 7px 10px; border-radius: 999px; background: var(--teal); color: #fff; font-weight: 700; }",
        "</style>",
        "<section class=\"chrono-html-demo\">",
        "  <strong>HTML/CSS 프리뷰</strong>",
        "  <p><code>&lt;style&gt;</code>과 안전한 HTML 태그만으로도 라이트/다크 테마에 맞춰 보입니다.</p>",
        "  <span class=\"metric\">JS 없이 표현만 허용</span>",
        "</section>"
      ].join("\n")
    }];
  }
}

function buildGuestFolders() {
  purgeExpiredGuestTrash();
  const counts = new Map();
  for (const memo of state.guestMemos) {
    const key = memo.folder || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  if (!state.guestFolders.some((folder) => (folder.name || "") === TRASH_FOLDER_NAME)) {
    state.guestFolders.push({
      name: TRASH_FOLDER_NAME,
      label: TRASH_FOLDER_NAME,
      icon: TRASH_FOLDER_ICON,
      position: state.guestFolders.length,
      memo_count: 0
    });
  }

  for (const folderName of counts.keys()) {
    if (!state.guestFolders.some((folder) => (folder.name || "") === folderName)) {
      state.guestFolders.push({
        name: folderName,
        label: folderName || "기본 폴더",
        icon: folderName === TRASH_FOLDER_NAME ? TRASH_FOLDER_ICON : "📁",
        position: state.guestFolders.length,
        memo_count: 0
      });
    }
  }

  return [...state.guestFolders]
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((folder) => ({
      ...folder,
      label: folder.label || folder.name || "기본 폴더",
      icon: (folder.name || "") === TRASH_FOLDER_NAME ? TRASH_FOLDER_ICON : (folder.icon || "📁"),
      memo_count: counts.get(folder.name || "") || 0
    }));
}

function buildGuestTags() {
  const counts = new Map();
  for (const memo of state.guestMemos) {
    if (isTrashedMemo(memo)) continue;
    for (const tag of memo.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ko-KR"))
    .map(([name, memo_count]) => ({ name, memo_count }));
}

function memoExcerpt(content) {
  return String(content || "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function isTrashedMemo(memo) {
  return Boolean(memo?.trashed_at) || (memo?.folder || "") === TRASH_FOLDER_NAME;
}

function purgeExpiredGuestTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  state.guestMemos = state.guestMemos.filter((memo) => {
    if (!isTrashedMemo(memo)) return true;
    const trashedAt = Date.parse(memo.trashed_at || "");
    return !trashedAt || trashedAt > cutoff;
  });
}

function renderMemoList() {
  elements.memoList.innerHTML = "";
  const visibleMemos = state.memos.filter((memo) => !isTrashedMemo(memo));
  elements.mobileListCount.textContent = `${visibleMemos.length}개 메모`;
  renderMemoSelectionBar();

  const folders = buildFolderGroups();
  for (const memo of visibleMemos) {
    const folderName = memo.folder || "";
    if (!folders.has(folderName)) {
      folders.set(folderName, {
        name: folderName,
        label: folderName || "기본 폴더",
        icon: "📁",
        memos: []
      });
    }
    folders.get(folderName).memos.push(memo);
  }

  for (const folder of folders.values()) {
    const memos = folder.memos.sort(compareMemos);
    const isTrashFolder = folder.name === TRASH_FOLDER_NAME;
    const details = document.createElement("details");
    details.className = `folder-group ${isTrashFolder ? "trash-folder" : ""}`;
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "folder-header";
    summary.innerHTML = `
      <div class="folder-title">
        <span class="folder-drag-handle" role="button" tabindex="0" data-tooltip="꾹 눌러 폴더 이동" aria-label="꾹 눌러 폴더 이동">⋮⋮</span>
        <span class="folder-toggle">▾</span>
        <button class="folder-icon-button" type="button" data-tooltip="폴더 이모지 변경" aria-label="폴더 이모지 변경">${escapeHtml(folder.icon || "📁")}</button>
        <span class="folder-name">${escapeHtml(folder.label)}</span>
      </div>
      <div class="folder-controls">
        <span class="folder-count">${memos.length}</span>
        ${folder.name && !isTrashFolder ? '<button class="folder-delete" type="button" data-tooltip="폴더 삭제" aria-label="폴더 삭제">×</button>' : ""}
      </div>
    `;
    details.dataset.folder = folder.name;
    summary.querySelector(".folder-icon-button").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      editFolderIcon(folder.name, folder.icon, event.currentTarget);
    });
    bindDragHandle(summary.querySelector(".folder-drag-handle"), {
      type: "folder",
      item: details,
      id: folder.name
    });
    const folderDeleteButton = summary.querySelector(".folder-delete");
    if (folderDeleteButton) {
      folderDeleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteFolderByName(folder.name, folder.label, memos.length);
      });
    }
    details.appendChild(summary);

    const items = document.createElement("div");
    items.className = "folder-items";
    items.classList.toggle("single-memo-folder", memos.length === 1);

    for (const memo of memos) {
      const item = document.createElement("article");
      const activeInEditor = state.route.page === "editor" && state.current?.id === memo.id;
      item.className = `memo-item ${activeInEditor ? "active" : ""} ${memo.pinned ? "pinned" : ""} ${isTrashedMemo(memo) ? "trashed" : ""} ${state.selectedMemoIds.has(memo.id) ? "selected" : ""}`;
      item.dataset.memoId = memo.id;
      item.innerHTML = `
        <button class="memo-open" type="button">
          <span class="memo-title-row">
            <strong>${escapeHtml(memo.title)}</strong>
            ${memo.pinned ? '<span class="pin-indicator" aria-label="고정됨">★</span>' : ""}
          </span>
          <p>${escapeHtml(memo.excerpt || "")}</p>
          <div class="tag-row">${memo.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        </button>
      `;
      bindMemoPress(item, memo);
      items.appendChild(item);
    }

    details.appendChild(items);
    elements.memoList.appendChild(details);
  }
}

function bindMemoPress(item, memo) {
  const openButton = item.querySelector(".memo-open");
  let longPressTimer = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let pointerId = null;
  let suppressClick = false;

  const clear = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    pointerId = null;
    item.classList.remove("pressing");
  };

  item.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (state.selectedMemoIds.has(memo.id)) {
      beginListDrag(event, {
        type: "memo",
        item,
        id: memo.id,
        grouped: true,
        delay: event.pointerType === "touch" ? 230 : 180,
        startOnMove: true,
        onTap: () => toggleMemoSelection(memo.id)
      });
      suppressClick = true;
      return;
    }

    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    pointerId = event.pointerId;
    item.classList.add("pressing");
    longPressTimer = setTimeout(() => {
      suppressClick = true;
      toggleMemoSelection(memo.id, true);
      navigator.vibrate?.(12);
      beginListDrag(event, {
        type: "memo",
        item,
        id: memo.id,
        origin: item,
        grouped: true,
        delay: 0,
        initialLastX: lastX,
        initialLastY: lastY,
        cancelMoveThreshold: 24,
        startOnMove: true,
        onTap: () => {}
      });
    }, event.pointerType === "touch" ? 420 : 360);
  });

  item.addEventListener("pointermove", (event) => {
    if (!longPressTimer || event.pointerId !== pointerId) return;
    lastX = event.clientX;
    lastY = event.clientY;
    const moved = Math.hypot(lastX - startX, lastY - startY);
    if (moved > 24) clear();
  });

  for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
    item.addEventListener(eventName, clear);
  }

  openButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (state.selectedMemoIds.size) {
      toggleMemoSelection(memo.id);
      return;
    }
    openMemo(memo.id);
  });
}

function toggleMemoSelection(id, forceSelected) {
  const next = forceSelected ?? !state.selectedMemoIds.has(id);
  if (next) {
    state.selectedMemoIds.add(id);
  } else {
    state.selectedMemoIds.delete(id);
  }
  renderMemoSelectionBar();
  elements.memoList
    .querySelectorAll(`[data-memo-id="${cssEscape(id)}"]`)
    .forEach((item) => item.classList.toggle("selected", state.selectedMemoIds.has(id)));
}

function clearMemoSelection() {
  if (!state.selectedMemoIds.size) {
    renderMemoSelectionBar();
    return;
  }
  state.selectedMemoIds.clear();
  elements.memoList.querySelectorAll(".memo-item.selected").forEach((item) => item.classList.remove("selected"));
  renderMemoSelectionBar();
}

function renderMemoSelectionBar() {
  const count = state.selectedMemoIds.size;
  elements.memoSelectionBar.classList.toggle("hidden", count === 0);
  elements.memoSelectionCount.textContent = `${count}개 선택`;
  elements.appShell.classList.toggle("selection-mode", count > 0);
  const selectedMemos = state.memos.filter((memo) => state.selectedMemoIds.has(memo.id));
  const trashedCount = selectedMemos.filter(isTrashedMemo).length;
  const hasTrashed = trashedCount > 0;
  const allTrashed = selectedMemos.length > 0 && trashedCount === selectedMemos.length;
  const shouldPin = selectedMemos.some((memo) => !memo.pinned && !isTrashedMemo(memo));
  elements.pinSelectedMemosButton.textContent = shouldPin ? "고정" : "고정 해제";
  elements.pinSelectedMemosButton.classList.toggle("hidden", hasTrashed);
  elements.restoreSelectedMemosButton.classList.toggle("hidden", !hasTrashed);
  elements.deleteSelectedMemosButton.textContent = allTrashed ? "완전 삭제" : "휴지통";
}

async function pinSelectedMemos() {
  const ids = [...state.selectedMemoIds];
  if (!ids.length) return;
  const selectedMemos = state.memos.filter((memo) => state.selectedMemoIds.has(memo.id));
  const pinned = selectedMemos.some((memo) => !memo.pinned);

  try {
    if (!state.authenticated) {
      for (const memo of state.guestMemos) {
        if (!state.selectedMemoIds.has(memo.id)) continue;
        memo.pinned = pinned;
        memo.updated_at = new Date().toISOString();
      }
      const current = state.current && state.guestMemos.find((memo) => memo.id === state.current.id);
      if (current) state.current = { ...current };
      loadGuestMemos();
    } else {
      await Promise.all(ids.map((id) => api(`/api/memos/${encodeURIComponent(id)}/pin`, {
        method: "PATCH",
        body: { pinned }
      })));
      await loadMemos();
      if (state.current && state.selectedMemoIds.has(state.current.id)) {
        state.current = { ...state.current, pinned };
      }
    }
    clearMemoSelection();
    setStatus(pinned ? "선택 메모 고정됨" : "선택 메모 고정 해제됨");
  } catch (error) {
    setStatus(error.message);
  }
}

async function deleteSelectedMemos() {
  const ids = [...state.selectedMemoIds];
  if (!ids.length) return;
  const selectedMemos = state.memos.filter((memo) => state.selectedMemoIds.has(memo.id));
  const allTrashed = selectedMemos.length > 0 && selectedMemos.every(isTrashedMemo);
  const message = allTrashed
    ? `휴지통의 메모 ${ids.length}개를 완전히 삭제하시겠습니까?`
    : `선택한 메모 ${ids.length}개를 휴지통으로 이동하시겠습니까?`;
  if (!window.confirm(message)) return;

  const deletedCurrent = state.current && state.selectedMemoIds.has(state.current.id);
  try {
    if (!state.authenticated) {
      const now = new Date().toISOString();
      if (allTrashed) {
        state.guestMemos = state.guestMemos.filter((memo) => !state.selectedMemoIds.has(memo.id));
      } else {
        for (const memo of state.guestMemos) {
          if (!state.selectedMemoIds.has(memo.id)) continue;
          if (isTrashedMemo(memo)) continue;
          memo.original_folder = memo.folder === TRASH_FOLDER_NAME ? "" : (memo.folder || "");
          memo.folder = TRASH_FOLDER_NAME;
          memo.trashed_at = now;
          memo.pinned = false;
          memo.position = nextGuestMemoPosition(TRASH_FOLDER_NAME);
          memo.updated_at = now;
        }
      }
      if (deletedCurrent) {
        state.current = null;
        state.dirty = false;
      }
      loadGuestMemos();
    } else {
      await Promise.all(ids.map((id) => api(`/api/memos/${encodeURIComponent(id)}`, { method: "DELETE" })));
      if (deletedCurrent) {
        state.current = null;
        state.dirty = false;
      }
      await loadMemos();
    }
    clearMemoSelection();
    setStatus(allTrashed ? "선택 메모 완전 삭제됨" : "선택 메모 휴지통 이동됨");

    if (deletedCurrent) {
      const nextMemo = state.memos.find((memo) => !isTrashedMemo(memo));
      if (nextMemo) {
        await openMemo(nextMemo.id);
      } else {
        await createMemo();
      }
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function restoreSelectedMemos() {
  const ids = [...state.selectedMemoIds];
  if (!ids.length) return;
  const trashedIds = ids.filter((id) => {
    const memo = state.memos.find((item) => item.id === id);
    return isTrashedMemo(memo);
  });
  if (!trashedIds.length) return;

  try {
    if (!state.authenticated) {
      for (const memo of state.guestMemos) {
        if (!trashedIds.includes(memo.id)) continue;
        memo.folder = memo.original_folder || "";
        memo.original_folder = "";
        memo.trashed_at = null;
        memo.position = nextGuestMemoPosition(memo.folder);
        memo.updated_at = new Date().toISOString();
      }
      const current = state.current && state.guestMemos.find((memo) => memo.id === state.current.id);
      if (current) state.current = { ...current };
      loadGuestMemos();
    } else {
      await Promise.all(trashedIds.map((id) => api(`/api/memos/${encodeURIComponent(id)}/trash-restore`, {
        method: "POST"
      })));
      await loadMemos();
    }
    clearMemoSelection();
    setStatus("휴지통 메모 복원됨");
  } catch (error) {
    setStatus(error.message);
  }
}

function getTrashMemos() {
  return state.memos
    .filter(isTrashedMemo)
    .sort((a, b) => {
      const dateA = Date.parse(a.trashed_at || a.updated_at || "") || 0;
      const dateB = Date.parse(b.trashed_at || b.updated_at || "") || 0;
      if (dateA !== dateB) return dateB - dateA;
      return compareMemos(a, b);
    });
}

function renderTrashDialog() {
  const trashedMemos = getTrashMemos();
  elements.trashDialogMeta.textContent = trashedMemos.length
    ? `${trashedMemos.length}개 보관 중 · 7일 뒤 자동 삭제`
    : "보관된 메모가 없습니다.";
  elements.trashList.innerHTML = "";

  if (!trashedMemos.length) {
    const empty = document.createElement("div");
    empty.className = "trash-empty";
    empty.innerHTML = `
      <strong>휴지통이 비어 있습니다.</strong>
      <span>삭제한 메모가 생기면 여기에 보관됩니다.</span>
    `;
    elements.trashList.appendChild(empty);
    return;
  }

  for (const memo of trashedMemos) {
    const item = document.createElement("article");
    item.className = "trash-item";
    item.dataset.memoId = memo.id;
    const originalFolder = memo.original_folder || "기본 폴더";
    const trashedAt = memo.trashed_at ? formatDate(memo.trashed_at) : "방금";
    const expiresAt = memo.trashed_at
      ? formatDate(new Date(Date.parse(memo.trashed_at) + TRASH_RETENTION_MS).toISOString())
      : "7일 뒤";
    item.innerHTML = `
      <div class="trash-item-body">
        <span class="trash-item-kicker">보관됨 · ${escapeHtml(originalFolder)}</span>
        <strong>${escapeHtml(memo.title || "제목 없음")}</strong>
        <p>${escapeHtml(memo.excerpt || "")}</p>
        <div class="tag-row">${(memo.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <small>삭제 ${escapeHtml(trashedAt)} · 완전 삭제 ${escapeHtml(expiresAt)}</small>
      </div>
      <div class="trash-item-actions">
        <button class="secondary-button restore-trash-button" type="button">복원</button>
        <button class="secondary-button danger hard-delete-trash-button" type="button">완전 삭제</button>
      </div>
    `;
    item.querySelector(".restore-trash-button").addEventListener("click", () => restoreTrashMemo(memo.id));
    item.querySelector(".hard-delete-trash-button").addEventListener("click", () => hardDeleteTrashMemo(memo.id));
    elements.trashList.appendChild(item);
  }
}

async function openTrashDialog({ skipRoute = false } = {}) {
  if (!skipRoute && !(await confirmBeforeLeavingDirty())) return false;
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.accountDialog.open) elements.accountDialog.close();
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  clearMemoSelection();
  if (!skipRoute) writeRoute({ page: "trash", memoId: "" });
  state.isApplyingRoute = wasApplyingRoute;
  await loadMemosForTrashView();
  renderTrashDialog();
  if (!elements.trashDialog.open) elements.trashDialog.show();
  renderMobileChrome();
  return true;
}

async function restoreTrashMemo(id) {
  try {
    if (!state.authenticated) {
      const memo = state.guestMemos.find((item) => item.id === id);
      if (!memo || !isTrashedMemo(memo)) return;
      memo.folder = memo.original_folder || "";
      memo.original_folder = "";
      memo.trashed_at = null;
      memo.position = nextGuestMemoPosition(memo.folder);
      memo.updated_at = new Date().toISOString();
      await loadMemosForTrashView();
    } else {
      await api(`/api/memos/${encodeURIComponent(id)}/trash-restore`, { method: "POST" });
      await loadMemosForTrashView();
    }
    renderTrashDialog();
    setStatus("휴지통 메모 복원됨");
  } catch (error) {
    setStatus(error.message);
  }
}

async function hardDeleteTrashMemo(id) {
  const memo = state.memos.find((item) => item.id === id);
  if (!memo || !isTrashedMemo(memo)) return;
  if (!window.confirm(`「${memo.title || "제목 없음"}」 메모를 완전히 삭제할까요?`)) return;

  try {
    if (!state.authenticated) {
      state.guestMemos = state.guestMemos.filter((item) => item.id !== id);
      if (state.current?.id === id) state.current = null;
      await loadMemosForTrashView();
    } else {
      await api(`/api/memos/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (state.current?.id === id) state.current = null;
      await loadMemosForTrashView();
    }
    renderTrashDialog();
    setStatus("휴지통 메모 완전 삭제됨");
  } catch (error) {
    setStatus(error.message);
  }
}

function renderTagFilters() {
  elements.clearTagFilterButton.classList.toggle("hidden", !state.activeTag);
  elements.tagFilterList.innerHTML = "";

  for (const tag of state.tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tag-filter ${state.activeTag === tag.name ? "active" : ""}`;
    button.innerHTML = `
      <span>#${escapeHtml(tag.name)}</span>
      <small>${Number(tag.memo_count || 0)}</small>
    `;
    button.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag.name ? "" : tag.name;
      loadMemos();
    });
    elements.tagFilterList.appendChild(button);
  }
}

function buildFolderGroups() {
  const folders = new Map();
  const ordered = state.folders.length
    ? state.folders.filter((folder) => (folder.name || "") !== TRASH_FOLDER_NAME)
    : [{ name: "", label: "기본 폴더", icon: "📁" }];

  for (const folder of ordered) {
    folders.set(folder.name || "", {
      name: folder.name || "",
      label: folder.label || folder.name || "기본 폴더",
      icon: (folder.name || "") === TRASH_FOLDER_NAME ? TRASH_FOLDER_ICON : (folder.icon || "📁"),
      memos: []
    });
  }

  return folders;
}

function compareMemos(a, b) {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  const positionA = Number(a.position || 0);
  const positionB = Number(b.position || 0);
  if (positionA !== positionB) return positionA - positionB;
  const dateA = Date.parse(a.updated_at || "") || 0;
  const dateB = Date.parse(b.updated_at || "") || 0;
  if (dateA !== dateB) return dateB - dateA;
  return String(a.title || "").localeCompare(String(b.title || ""), "ko-KR");
}

function renderFolderPicker(selectedValue = "") {
  const value = selectedValue || "";
  const folders = state.folders.length
    ? state.folders.filter((folder) => (folder.name || "") !== TRASH_FOLDER_NAME)
    : [{ name: "", label: "기본 폴더", icon: "📁" }];
  const hasSelected = folders.some((folder) => (folder.name || "") === value);
  const options = hasSelected
    ? folders
    : [...folders, { name: value, label: value || "기본 폴더", icon: "📁" }];
  const selected = options.find((folder) => (folder.name || "") === value) || options[0];

  state.selectedFolder = selected?.name || "";
  elements.folderPickerIcon.textContent = selected?.icon || "📁";
  elements.folderPickerLabel.textContent = selected?.label || selected?.name || "기본 폴더";
  elements.folderPickerMenu.innerHTML = "";

  for (const folder of options) {
    const name = folder.name || "";
    const option = document.createElement("button");
    option.type = "button";
    option.className = `folder-picker-option ${name === state.selectedFolder ? "active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", name === state.selectedFolder ? "true" : "false");
    option.innerHTML = `
      <span class="folder-picker-option-icon">${escapeHtml(folder.icon || "📁")}</span>
      <span>${escapeHtml(folder.label || name || "기본 폴더")}</span>
      <small>${Number(folder.memo_count || 0)}</small>
    `;
    option.addEventListener("click", () => {
      state.selectedFolder = name;
      closeFolderPicker();
      renderFolderPicker(name);
      markEditorDirty();
    });
    elements.folderPickerMenu.appendChild(option);
  }
}

function toggleFolderPicker() {
  if (state.folderPickerOpen) {
    closeFolderPicker();
  } else {
    openFolderPicker();
  }
}

function openFolderPicker() {
  state.folderPickerOpen = true;
  elements.folderPicker.classList.add("open");
  elements.folderPickerButton.setAttribute("aria-expanded", "true");
  elements.folderPickerMenu.classList.remove("hidden");
}

function closeFolderPicker() {
  state.folderPickerOpen = false;
  elements.folderPicker.classList.remove("open");
  elements.folderPickerButton.setAttribute("aria-expanded", "false");
  elements.folderPickerMenu.classList.add("hidden");
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  const isRegister = state.authMode === "register";
  elements.authCard.classList.toggle("register-mode", isRegister);
  elements.loginModeButton.classList.toggle("active", !isRegister);
  elements.registerModeButton.classList.toggle("active", isRegister);
  elements.authPasswordInput.autocomplete = isRegister ? "new-password" : "current-password";
  elements.authPasswordConfirmField.classList.toggle("hidden", !isRegister);
  elements.authPasswordConfirmInput.classList.toggle("hidden", !isRegister);
  elements.authConsentGroup.classList.toggle("hidden", !isRegister);
  elements.authSwitchRegister.classList.toggle("hidden", isRegister);
  elements.authSwitchLogin.classList.toggle("hidden", !isRegister);
  elements.authModeTitle.textContent = isRegister ? "회원가입" : "로그인";
  elements.passwordAuthButton.textContent = isRegister ? "회원가입" : "로그인";
  elements.googleLoginLink.querySelector("strong").textContent = isRegister ? "Google로 회원가입" : "Google로 계속";
  elements.authEmailInput.placeholder = "이메일 주소";
  elements.authPasswordInput.placeholder = "비밀번호";
  elements.authPasswordConfirmInput.placeholder = "비밀번호 확인";
  updateAuthValidation({ checkEmail: isRegister });
}

function updateAuthValidation({ checkEmail = false } = {}) {
  const isRegister = state.authMode === "register";
  if (!isRegister) {
    clearAuthStatus(elements.authEmailStatus);
    clearAuthStatus(elements.authPasswordStatus);
    clearAuthStatus(elements.authPasswordConfirmStatus);
    elements.passwordAuthButton.disabled = false;
    syncGoogleRegistrationLink();
    return true;
  }

  const email = elements.authEmailInput.value.trim();
  const password = elements.authPasswordInput.value;
  const passwordConfirm = elements.authPasswordConfirmInput.value;
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const checkedEmail = state.emailAvailability?.email === email ? state.emailAvailability : null;
  const passwordReady = password.length >= 8;
  const confirmReady = Boolean(passwordConfirm) && password === passwordConfirm;

  if (!email) {
    clearAuthStatus(elements.authEmailStatus);
  } else if (!emailLooksValid) {
    setAuthStatus(elements.authEmailStatus, "bad", "이메일 형식");
  } else if (checkedEmail) {
    if (checkedEmail.available) {
      setAuthStatus(elements.authEmailStatus, "ok", "사용 가능");
    } else if (checkedEmail.pending_deletion) {
      setAuthStatus(elements.authEmailStatus, "bad", "복구 대기 중");
    } else {
      setAuthStatus(elements.authEmailStatus, "bad", "이미 가입됨");
    }
  } else if (checkEmail) {
    scheduleEmailAvailabilityCheck(email);
  } else {
    setAuthStatus(elements.authEmailStatus, "pending", "확인 대기");
  }

  if (!password) {
    clearAuthStatus(elements.authPasswordStatus);
  } else {
    setAuthStatus(elements.authPasswordStatus, passwordReady ? "ok" : "bad", passwordReady ? "사용 가능" : "8자 이상");
  }

  if (!passwordConfirm) {
    clearAuthStatus(elements.authPasswordConfirmStatus);
  } else {
    setAuthStatus(elements.authPasswordConfirmStatus, confirmReady ? "ok" : "bad", confirmReady ? "일치" : "일치하지 않음");
  }

  const valid = emailLooksValid && passwordReady && confirmReady
    && checkedEmail?.available !== false && registrationConsentReady();
  elements.passwordAuthButton.disabled = !valid;
  syncGoogleRegistrationLink();
  return valid;
}

function registrationConsentReady() {
  return Boolean(
    elements.termsConsentCheckbox.checked
    && elements.privacyConsentCheckbox.checked
    && elements.ageConsentCheckbox.checked
  );
}

function syncGoogleRegistrationLink() {
  const isRegister = state.authMode === "register";
  const consentReady = registrationConsentReady();
  const enabled = Boolean(state.capabilities.google_oauth) && (!isRegister || consentReady);
  elements.googleLoginLink.href = isRegister
    ? "/api/auth/google/start?mode=register&terms_accepted=1&privacy_accepted=1&age_confirmed=1"
    : "/api/auth/google/start";
  elements.googleLoginLink.classList.toggle("disabled", !enabled);
  elements.googleLoginLink.setAttribute("aria-disabled", enabled ? "false" : "true");
}

function scheduleEmailAvailabilityCheck(email) {
  clearTimeout(state.emailCheckTimer);
  const requestId = ++state.emailCheckRequest;
  setAuthStatus(elements.authEmailStatus, "pending", "확인 중");

  state.emailCheckTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/auth/email?email=${encodeURIComponent(email)}`);
      if (requestId !== state.emailCheckRequest || state.authMode !== "register") return;
      state.emailAvailability = result;
      updateAuthValidation();
    } catch (error) {
      if (requestId !== state.emailCheckRequest || state.authMode !== "register") return;
      state.emailAvailability = null;
      setAuthStatus(elements.authEmailStatus, "bad", error.message);
    }
  }, 260);
}

function setAuthStatus(element, status, label) {
  const icon = status === "ok" ? "✓" : (status === "pending" ? "…" : "×");
  element.textContent = `${icon} ${label}`;
  element.className = `auth-status ${status}`;
}

function clearAuthStatus(element) {
  element.textContent = "";
  element.className = "auth-status hidden";
}

function updateAccountPasswordValidation() {
  if (!state.authenticated || state.user?.has_password) {
    clearAuthStatus(elements.accountPasswordStatus);
    clearAuthStatus(elements.accountPasswordConfirmStatus);
    return true;
  }

  const password = elements.accountPasswordInput.value;
  const passwordConfirm = elements.accountPasswordConfirmInput.value;
  const passwordReady = password.length >= 8;
  const confirmReady = Boolean(passwordConfirm) && password === passwordConfirm;

  if (!password) {
    clearAuthStatus(elements.accountPasswordStatus);
  } else {
    setAuthStatus(elements.accountPasswordStatus, passwordReady ? "ok" : "bad", passwordReady ? "사용 가능" : "8자 이상");
  }

  if (!passwordConfirm) {
    clearAuthStatus(elements.accountPasswordConfirmStatus);
  } else {
    setAuthStatus(elements.accountPasswordConfirmStatus, confirmReady ? "ok" : "bad", confirmReady ? "일치" : "일치하지 않음");
  }

  return passwordReady && confirmReady;
}

function clearAccountPasswordFields() {
  elements.accountPasswordInput.value = "";
  elements.accountPasswordConfirmInput.value = "";
  clearAuthStatus(elements.accountPasswordStatus);
  clearAuthStatus(elements.accountPasswordConfirmStatus);
}

function markEditorDirty() {
  state.dirty = true;
  setStatus("수정됨");
  elements.recoveryBanner.classList.add("hidden");
  renderStartGuideAction();
  renderMobileChrome();
  renderPreview();
  scheduleAutosave();
}

async function createFolderFromInput() {
  const name = elements.folderNameInput.value.trim();
  const icon = normalizeEmojiInput(elements.folderIconInput.value);
  if (!name) {
    elements.folderNameInput.focus();
    setStatus("폴더 이름 필요");
    return;
  }
  if (name === TRASH_FOLDER_NAME) {
    setStatus("휴지통은 설정에서 따로 열 수 있습니다.");
    return;
  }

  if (!state.authenticated) {
    ensureGuestData();
    if (state.guestFolders.some((folder) => (folder.name || "") === name)) {
      setStatus("이미 있는 폴더입니다.");
      return;
    }
    state.guestFolders.push({
      name,
      label: name,
      icon,
      position: state.guestFolders.length,
      memo_count: 0
    });
    elements.folderNameInput.value = "";
    elements.folderIconInput.value = "";
    state.selectedFolder = name;
    loadGuestMemos();
    setStatus("체험 폴더 생성됨");
    return;
  }

  try {
    const data = await api("/api/folders", {
      method: "POST",
      body: { name, icon }
    });
    state.folders = data.folders;
    elements.folderNameInput.value = "";
    elements.folderIconInput.value = "";
    renderFolderPicker(state.current?.folder ?? state.selectedFolder);
    renderMemoList();
    setStatus("폴더 생성됨");
  } catch (error) {
    setStatus(error.message);
  }
}

function editFolderIcon(name, currentIcon, anchor) {
  closeFolderIconEditor();

  const popover = document.createElement("div");
  popover.className = "folder-icon-popover";
  popover.innerHTML = `
    <input class="folder-icon-popover-input" type="text" maxlength="4" value="${escapeHtml(currentIcon || "📁")}" aria-label="폴더 이모지" />
    <button class="folder-icon-popover-save" type="button">저장</button>
  `;
  document.body.appendChild(popover);

  const rect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  popover.style.top = `${clamp(rect.bottom + 6, 8, window.innerHeight - popoverRect.height - 8)}px`;
  popover.style.left = `${clamp(rect.left, 8, window.innerWidth - popoverRect.width - 8)}px`;

  const input = popover.querySelector(".folder-icon-popover-input");
  const saveButton = popover.querySelector(".folder-icon-popover-save");
  const save = async () => {
    await saveFolderIcon(name, input.value);
    closeFolderIconEditor();
  };
  const onOutside = (event) => {
    if (!popover.contains(event.target) && event.target !== anchor) closeFolderIconEditor();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
    if (event.key === "Escape") closeFolderIconEditor();
  });
  saveButton.addEventListener("click", save);
  setTimeout(() => document.addEventListener("pointerdown", onOutside), 0);
  state.iconEditor = { popover, onOutside };
  input.focus();
  input.select();
}

function closeFolderIconEditor() {
  if (!state.iconEditor) return;
  document.removeEventListener("pointerdown", state.iconEditor.onOutside);
  state.iconEditor.popover.remove();
  state.iconEditor = null;
}

async function saveFolderIcon(name, nextIcon) {
  if (!state.authenticated) {
    ensureGuestData();
    const cleanName = name || "";
    const folder = state.guestFolders.find((item) => (item.name || "") === cleanName);
    if (folder) folder.icon = normalizeEmojiInput(nextIcon);
    loadGuestMemos();
    setStatus("폴더 아이콘 변경됨");
    return;
  }

  try {
    const data = await api("/api/folders/icon", {
      method: "PATCH",
      body: { name, icon: normalizeEmojiInput(nextIcon) }
    });
    state.folders = data.folders;
    renderFolderPicker(state.current?.folder ?? state.selectedFolder);
    renderMemoList();
    setStatus("폴더 아이콘 변경됨");
  } catch (error) {
    setStatus(error.message);
  }
}

async function deleteFolderByName(name, label, memoCount = 0) {
  const cleanName = name || "";
  if (!cleanName) {
    setStatus("기본 폴더는 삭제할 수 없습니다.");
    return;
  }
  if (cleanName === TRASH_FOLDER_NAME) {
    setStatus("휴지통은 삭제할 수 없습니다.");
    return;
  }

  if (state.dirty) {
    await autosaveCurrentMemo();
    if (state.dirty) {
      setStatus("먼저 현재 메모를 저장해주세요.");
      return;
    }
  }

  const message = memoCount
    ? `「${label || cleanName}」 폴더를 삭제할까요? 안의 메모 ${memoCount}개는 기본 폴더로 이동합니다.`
    : `「${label || cleanName}」 폴더를 삭제할까요?`;
  if (!window.confirm(message)) return;

  if (!state.authenticated) {
    const movedStart = nextGuestMemoPosition("");
    let moved = 0;
    for (const memo of state.guestMemos) {
      if ((memo.folder || "") !== cleanName) continue;
      memo.folder = "";
      memo.position = movedStart + moved;
      memo.updated_at = new Date().toISOString();
      moved += 1;
    }
    state.guestFolders = state.guestFolders.filter((folder) => (folder.name || "") !== cleanName);
    if (state.selectedFolder === cleanName) state.selectedFolder = "";
    const current = state.current && state.guestMemos.find((memo) => memo.id === state.current.id);
    if (current) {
      state.current = { ...current };
      writeEditor(state.current);
      renderPreview();
    }
    loadGuestMemos();
    setStatus("폴더 삭제됨");
    return;
  }

  try {
    const affectedCurrent = state.current?.folder === cleanName;
    const data = await api("/api/folders", {
      method: "DELETE",
      body: { name: cleanName }
    });
    state.folders = data.folders;
    if (state.selectedFolder === cleanName) state.selectedFolder = "";
    await loadMemos();
    if (affectedCurrent && state.current) await openMemo(state.current.id);
    setStatus(data.moved_count ? `폴더 삭제됨, 메모 ${data.moved_count}개 이동됨` : "폴더 삭제됨");
  } catch (error) {
    setStatus(error.message);
  }
}

function bindDragHandle(handle, { type, item, id }) {
  if (!handle) return;

  handle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  handle.addEventListener("pointerdown", (event) => {
    beginListDrag(event, {
      type,
      item,
      id,
      origin: handle,
      delay: event.pointerType === "touch" ? 220 : 160
    });
  });
}

function beginListDrag(event, {
  type,
  item,
  id,
  origin = event.currentTarget,
  grouped = false,
  delay = 180,
  onTap = null,
  onStart = null,
  initialLastX = event.clientX,
  initialLastY = event.clientY,
  cancelMoveThreshold = 18,
  startOnMove = false
}) {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  if (elements.searchInput.value.trim()) {
    setStatus("검색 중에는 정렬할 수 없음");
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (state.drag) cancelDrag(state.drag);

  const drag = {
    type,
    item,
    id,
    origin,
    grouped,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: initialLastX,
    lastY: initialLastY,
    active: false,
    hasMovedAfterStart: false,
    autoScrollVelocity: 0,
    autoScrollFrame: null,
    longPressTimer: null,
    startOnMove,
    onStart,
    onTap
  };

  const onPointerMove = (moveEvent) => {
    if (moveEvent.pointerId !== drag.pointerId) return;
    drag.lastX = moveEvent.clientX;
    drag.lastY = moveEvent.clientY;

    if (!drag.active) {
      const moved = Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY);
      if (moved > cancelMoveThreshold) {
        if (drag.startOnMove) {
          clearTimeout(drag.longPressTimer);
          startDrag(drag);
          moveEvent.preventDefault();
          moveDrag(drag);
        } else {
          cancelDrag(drag);
        }
      }
      return;
    }

    moveEvent.preventDefault();
    moveDrag(drag);
  };

  const onPointerUp = (upEvent) => {
    if (upEvent.pointerId !== drag.pointerId) return;
    finishDrag(drag);
  };

  const onPointerCancel = (cancelEvent) => {
    if (cancelEvent.pointerId !== drag.pointerId) return;
    cancelDrag(drag);
  };

  drag.cleanup = () => {
    clearTimeout(drag.longPressTimer);
    stopAutoScroll(drag);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    state.drag = null;
  };

  state.drag = drag;
  origin.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  drag.longPressTimer = setTimeout(() => startDrag(drag), delay);
}

function startDrag(drag) {
  if (state.drag !== drag || drag.active) return;
  drag.active = true;
  drag.onStart?.(drag);

  drag.items = drag.type === "memo" ? getMemoDragItems(drag.item) : [drag.item];
  drag.visualItem = drag.type === "memo" ? getMemoDragVisualItem(drag.item, drag.items) : drag.item;
  const rect = drag.visualItem.getBoundingClientRect();
  const rawOffsetX = drag.lastX - rect.left;
  const rawOffsetY = drag.lastY - rect.top;
  const pointerInsideVisual = rawOffsetX >= 0 && rawOffsetX <= rect.width && rawOffsetY >= 0 && rawOffsetY <= rect.height;
  drag.offsetX = pointerInsideVisual ? rawOffsetX : rect.width / 2;
  drag.offsetY = pointerInsideVisual ? rawOffsetY : Math.min(rect.height * 0.45, 72);
  drag.placeholder = document.createElement(drag.type === "memo" ? "article" : "div");
  drag.placeholder.className = `drag-placeholder ${drag.type}-placeholder`;
  configureDragPlaceholder(drag, rect);

  drag.visualItem.parentNode.insertBefore(drag.placeholder, drag.visualItem);
  drag.ghost = createDragGhost(drag, rect);
  document.body.appendChild(drag.ghost);
  drag.items
    .filter((item) => item !== drag.ghost)
    .forEach((item) => item.classList.add("dragging-source"));
  document.body.classList.add("is-dragging-list-item");
  document.body.classList.toggle("is-dragging-memo-group", drag.type === "memo" && drag.items.length > 1);
  if (drag.type === "memo" && drag.items.length > 1) {
    setStatus(`메모 ${drag.items.length}개 이동 중`);
  }
  moveDrag(drag);
}

function getMemoDragItems(primaryItem) {
  const primaryId = primaryItem.dataset.memoId;
  if (!primaryId || !state.selectedMemoIds.has(primaryId)) return [primaryItem];
  const selected = [...elements.memoList.querySelectorAll(".memo-item")]
    .filter((item) => state.selectedMemoIds.has(item.dataset.memoId));
  return selected.length ? selected : [primaryItem];
}

function getMemoDragVisualItem(primaryItem, items) {
  for (const id of state.selectedMemoIds) {
    const selectedItem = items.find((item) => item.dataset.memoId === id);
    if (selectedItem) return selectedItem;
  }
  return primaryItem;
}

function createDragGhost(drag, rect) {
  const ghost = drag.type === "folder"
    ? drag.item.querySelector(".folder-header").cloneNode(true)
    : drag.visualItem;
  ghost.classList.add("drag-ghost", `${drag.type}-drag-ghost`);
  if (drag.type === "memo") {
    drag.usesOriginalGhost = true;
    drag.ghostOriginalStyle = ghost.getAttribute("style") || "";
    ghost.classList.add("drag-floating-card");
    ghost.dataset.dragCount = String(drag.items?.length || 1);
  }
  if (drag.type === "memo" && drag.items?.length > 1) {
    ghost.classList.add("memo-group-drag-ghost");
    addDragStackLayers(drag, ghost);
    const badge = document.createElement("span");
    badge.className = "drag-stack-badge";
    badge.textContent = `${drag.items.length}개`;
    drag.stackBadge = badge;
    ghost.appendChild(badge);
  }
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${drag.lastX - drag.offsetX}px`;
  ghost.style.top = `${drag.lastY - drag.offsetY}px`;
  return ghost;
}

function addDragStackLayers(drag, ghost) {
  const visibleLayerCount = Math.max((drag.items?.length || 1) - 1, 0);
  drag.stackLayers = [];

  for (let index = 1; index <= visibleLayerCount; index += 1) {
    const spread = index <= 7 ? index : 7 + (index - 7) * 0.28;
    const layer = document.createElement("span");
    layer.className = "drag-stack-layer";
    layer.style.setProperty("--stack-index", String(index));
    layer.style.zIndex = String(-index);
    layer.style.opacity = String(Math.max(0.2, 0.9 - index * 0.065));
    layer.style.transform = `translate(${spread * 8}px, ${spread * 7}px) rotate(${spread * 0.55}deg)`;
    ghost.appendChild(layer);
    drag.stackLayers.push(layer);
  }
}

function moveDrag(drag) {
  if (!drag.active) return;
  if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) > 6) drag.hasMovedAfterStart = true;
  drag.ghost.style.left = `${drag.lastX - drag.offsetX}px`;
  drag.ghost.style.top = `${drag.lastY - drag.offsetY}px`;
  drag.ghost.style.transform = "translate3d(0, 0, 0)";

  if (drag.type === "folder") {
    placeFolderPlaceholder(drag);
  } else {
    placeMemoPlaceholder(drag);
  }
  updateAutoScroll(drag);
}

function configureDragPlaceholder(drag, rect) {
  const minimumHeight = drag.type === "memo" ? 64 : 42;
  drag.placeholder.style.height = `${Math.max(minimumHeight, rect.height)}px`;
  drag.placeholder.style.removeProperty("grid-column");
  drag.placeholder.style.removeProperty("--placeholder-columns");
  drag.placeholder.style.removeProperty("--placeholder-rows");

  if (drag.type !== "memo" || drag.items.length <= 1) return;

  const parent = drag.visualItem.parentNode;
  const metrics = getMemoPlaceholderMetrics(parent, rect, drag.items.length);
  drag.placeholder.classList.add("group-placeholder");
  drag.placeholder.style.height = `${metrics.height}px`;
  drag.placeholder.style.setProperty("--placeholder-columns", String(metrics.columns));
  drag.placeholder.style.setProperty("--placeholder-rows", String(metrics.rows));
  drag.placeholder.dataset.dragCount = String(drag.items.length);
  if (metrics.isGrid) {
    drag.placeholder.style.gridColumn = `span ${metrics.columns}`;
  }
}

function getMemoPlaceholderMetrics(container, rect, count) {
  const styles = getComputedStyle(container);
  const rowGap = parseCssPixels(styles.rowGap || styles.gap);
  const isGrid = styles.display === "grid";
  const availableColumns = isGrid ? getGridColumnCount(styles) : 1;
  const columns = Math.max(1, Math.min(count, availableColumns));
  const rows = Math.max(1, Math.ceil(count / columns));
  const height = Math.max(64, Math.round(rows * rect.height + Math.max(0, rows - 1) * rowGap));
  return { columns, rows, height, isGrid };
}

function getGridColumnCount(styles) {
  const columns = styles.gridTemplateColumns
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  return Math.max(1, columns.length);
}

function parseCssPixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function placeFolderPlaceholder(drag) {
  const siblings = [...elements.memoList.querySelectorAll(".folder-group:not(.dragging-source)")];
  const before = siblings.find((folder) => {
    const rect = folder.getBoundingClientRect();
    return drag.lastY < rect.top + rect.height / 2;
  });

  placePlaceholder(elements.memoList, drag.placeholder, before || null);
}

function placeMemoPlaceholder(drag) {
  const targetGroup = findTargetFolderGroup(drag.lastY);
  if (!targetGroup) return;
  targetGroup.open = true;

  const items = targetGroup.querySelector(".folder-items");
  const siblings = [...items.querySelectorAll(".memo-item:not(.dragging-source)")];
  const isGridDrop = isMultiColumnGrid(items);
  const before = siblings.find((memo) => {
    const rect = memo.getBoundingClientRect();
    return shouldInsertBeforeMemo(rect, drag.lastX, drag.lastY, isGridDrop);
  });

  placePlaceholder(items, drag.placeholder, before || null);
}

function isMultiColumnGrid(container) {
  const styles = getComputedStyle(container);
  if (styles.display !== "grid") return false;
  return styles.gridTemplateColumns.split(" ").filter(Boolean).length > 1;
}

function shouldInsertBeforeMemo(rect, x, y, useInlineAxis = false) {
  if (!useInlineAxis) return y < rect.top + rect.height / 2;

  const midpointY = rect.top + rect.height / 2;
  const midpointX = rect.left + rect.width / 2;
  const rowTolerance = Math.min(54, Math.max(24, rect.height * 0.36));

  if (y < midpointY - rowTolerance) return true;
  if (y > midpointY + rowTolerance) return false;
  return x < midpointX;
}

function placePlaceholder(parent, placeholder, before) {
  if (placeholder.parentNode === parent && placeholder.nextSibling === before) return;
  if (placeholder.parentNode === parent && !before && placeholder.nextSibling === null) return;

  const snapshot = snapshotReflow(parent);
  parent.insertBefore(placeholder, before);
  animateReflow(snapshot);
}

function snapshotReflow(parent) {
  return new Map([...parent.children]
    .filter((child) => !child.classList.contains("dragging-source"))
    .map((child) => [child, child.getBoundingClientRect()]));
}

function animateReflow(snapshot) {
  for (const [element, first] of snapshot) {
    if (!element.isConnected) continue;
    const last = element.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

    element.classList.remove("layout-moving");
    element.style.transition = "none";
    element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    requestAnimationFrame(() => {
      element.classList.add("layout-moving");
      element.style.transition = "";
      element.style.transform = "";
      window.setTimeout(() => element.classList.remove("layout-moving"), 190);
    });
  }
}

function findTargetFolderGroup(y) {
  const groups = [...elements.memoList.querySelectorAll(".folder-group")];
  if (!groups.length) return null;

  for (const group of groups) {
    const rect = group.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) return group;
  }

  const before = groups.find((group) => y < group.getBoundingClientRect().top);
  return before || groups.at(-1);
}

function updateAutoScroll(drag) {
  const rect = elements.memoList.getBoundingClientRect();
  const threshold = 88;
  let velocity = 0;

  if (drag.lastY < rect.top + threshold) {
    const distance = rect.top + threshold - drag.lastY;
    velocity = -clamp(distance / threshold, 0, 2.4) * 20;
  } else if (drag.lastY > rect.bottom - threshold) {
    const distance = drag.lastY - (rect.bottom - threshold);
    velocity = clamp(distance / threshold, 0, 2.4) * 20;
  }

  drag.autoScrollVelocity = velocity;
  if (!velocity) {
    stopAutoScroll(drag);
    return;
  }

  if (!drag.autoScrollFrame) {
    const tick = () => {
      elements.memoList.scrollTop += drag.autoScrollVelocity;
      if (drag.active) moveDrag(drag);
      drag.autoScrollFrame = drag.autoScrollVelocity
        ? requestAnimationFrame(tick)
        : null;
    };
    drag.autoScrollFrame = requestAnimationFrame(tick);
  }
}

function stopAutoScroll(drag) {
  if (drag.autoScrollFrame) {
    cancelAnimationFrame(drag.autoScrollFrame);
    drag.autoScrollFrame = null;
  }
  drag.autoScrollVelocity = 0;
}

function cancelDrag(drag) {
  if (drag.active) {
    restoreDragInPlace(drag);
  }
  drag.cleanup?.();
}

async function finishDrag(drag) {
  clearTimeout(drag.longPressTimer);

  if (!drag.active) {
    drag.onTap?.();
    drag.cleanup?.();
    return;
  }

  if (!drag.hasMovedAfterStart) {
    restoreDragInPlace(drag);
    drag.cleanup?.();
    return;
  }

  const targetParent = drag.placeholder.parentNode;
  const movedItems = drag.type === "memo" ? (drag.items || [drag.item]) : [drag.item];
  releaseDragSurface(drag);
  movedItems.forEach((item) => targetParent.insertBefore(item, drag.placeholder));
  drag.placeholder.remove();
  clearDragStateClasses(drag);
  drag.cleanup?.();

  if (drag.type === "folder") {
    await persistFolderOrder();
  } else {
    await persistMemoOrder();
  }
}

function restoreDragInPlace(drag) {
  const parent = drag.placeholder?.parentNode;
  releaseDragSurface(drag);
  if (drag.usesOriginalGhost && drag.ghost && parent) {
    parent.insertBefore(drag.ghost, drag.placeholder);
  }
  drag.placeholder?.remove();
  clearDragStateClasses(drag);
}

function releaseDragSurface(drag) {
  if (!drag.ghost) return;

  if (!drag.usesOriginalGhost) {
    drag.ghost.remove();
    return;
  }

  drag.stackBadge?.remove();
  drag.stackLayers?.forEach((layer) => layer.remove());
  drag.stackLayers = [];
  drag.ghost.classList.remove(
    "drag-ghost",
    "memo-drag-ghost",
    "memo-group-drag-ghost",
    "drag-floating-card"
  );
  delete drag.ghost.dataset.dragCount;
  if (drag.ghostOriginalStyle) {
    drag.ghost.setAttribute("style", drag.ghostOriginalStyle);
  } else {
    drag.ghost.removeAttribute("style");
  }
}

function clearDragStateClasses(drag) {
  (drag.items || [drag.item]).forEach((item) => item.classList.remove("dragging-source", "pressing"));
  document.body.classList.remove("is-dragging-list-item", "is-dragging-memo-group");
}

async function persistFolderOrder() {
  const names = [...elements.memoList.querySelectorAll(".folder-group")]
    .map((group) => group.dataset.folder || "");
  for (const folder of state.folders) {
    const name = folder.name || "";
    if (!names.includes(name)) names.push(name);
  }

  if (!state.authenticated) {
    const existing = new Map(state.guestFolders.map((folder) => [folder.name || "", folder]));
    state.guestFolders = names.map((name, index) => ({
      ...(existing.get(name) || { name, label: name || "기본 폴더", icon: "📁" }),
      position: index
    }));
    loadGuestMemos();
    setStatus("폴더 순서 저장됨");
    return;
  }

  try {
    const data = await api("/api/folders/order", {
      method: "PATCH",
      body: { names }
    });
    state.folders = data.folders;
    renderFolderPicker(state.current?.folder ?? state.selectedFolder);
    renderMemoList();
    setStatus("폴더 순서 저장됨");
  } catch (error) {
    setStatus(error.message);
    await loadMemos();
  }
}

async function persistMemoOrder() {
  const groups = [...elements.memoList.querySelectorAll(".folder-group")].map((group) => ({
    folder: group.dataset.folder || "",
    memoIds: [...group.querySelectorAll(".memo-item")].map((memo) => memo.dataset.memoId)
  }));

  if (!state.authenticated) {
    const groupByMemoId = new Map();
    for (const group of groups) {
      group.memoIds.forEach((id, index) => groupByMemoId.set(id, {
        folder: group.folder,
        position: index + 1
      }));
    }
    for (const memo of state.guestMemos) {
      const next = groupByMemoId.get(memo.id);
      if (!next) continue;
      const wasTrashed = isTrashedMemo(memo);
      const movingToTrash = next.folder === TRASH_FOLDER_NAME;
      if (movingToTrash && !wasTrashed) {
        memo.original_folder = memo.folder === TRASH_FOLDER_NAME ? "" : (memo.folder || "");
        memo.trashed_at = new Date().toISOString();
        memo.pinned = false;
      }
      if (!movingToTrash && wasTrashed) {
        memo.original_folder = "";
        memo.trashed_at = null;
      }
      memo.folder = next.folder;
      memo.position = next.position;
    }
    const current = state.current && state.guestMemos.find((memo) => memo.id === state.current.id);
    if (current) state.current = { ...current };
    loadGuestMemos();
    setStatus("메모 순서 저장됨");
    return;
  }

  try {
    const data = await api("/api/memos/order", {
      method: "PATCH",
      body: { groups }
    });
    state.memos = data.memos;
    const current = state.current && state.memos.find((memo) => memo.id === state.current.id);
    if (current) state.current = { ...state.current, folder: current.folder, position: current.position };
    await loadMemos();
    setStatus("메모 순서 저장됨");
  } catch (error) {
    setStatus(error.message);
    await loadMemos();
  }
}

function normalizeEmojiInput(value) {
  const clean = String(value || "").trim();
  return clean ? [...clean][0] : "📁";
}

async function toggleMemoPin(id, pinned) {
  if (!state.authenticated) {
    const memo = state.guestMemos.find((item) => item.id === id);
    if (!memo) return;
    memo.pinned = Boolean(pinned);
    memo.updated_at = new Date().toISOString();
    if (state.current?.id === id) state.current = { ...memo };
    loadGuestMemos();
    setStatus(pinned ? "메모 고정됨" : "메모 고정 해제됨");
    return;
  }

  try {
    const data = await api(`/api/memos/${encodeURIComponent(id)}/pin`, {
      method: "PATCH",
      body: { pinned }
    });
    if (state.current?.id === id) {
      state.current = { ...state.current, pinned: data.memo.pinned };
    }
    setStatus(pinned ? "메모 고정됨" : "메모 고정 해제됨");
    await loadMemos();
  } catch (error) {
    setStatus(error.message);
  }
}

async function createMemo({ skipRoute = false } = {}) {
  if (!state.isApplyingRoute && state.dirty && !(await confirmBeforeLeavingDirty())) return;

  if (!state.authenticated) {
    ensureGuestData();
    const now = new Date().toISOString();
    const folder = state.selectedFolder || "";
    const memo = {
      id: createGuestId(),
      title: "새 메모",
      folder,
      tags: [],
      pinned: false,
      position: nextGuestMemoPosition(folder),
      created_at: now,
      updated_at: now,
      content: ""
    };
    state.guestMemos.push(memo);
    loadGuestMemos();
    await openMemo(memo.id, { skipRoute });
    setSidebarCollapsed(isMobileLayout());
    elements.titleInput.select();
    setStatus("체험 메모 생성됨");
    return;
  }

  const data = await api("/api/memos", {
    method: "POST",
    body: {
      title: "새 메모",
      tags: [],
      folder: state.selectedFolder,
      content: ""
    }
  });
  await loadMemos();
  await openMemo(data.memo.id, { skipRoute });
  setSidebarCollapsed(isMobileLayout());
  elements.titleInput.select();
}

async function openMemo(id, { skipRoute = false } = {}) {
  if (state.current?.id !== id && !state.isApplyingRoute && state.dirty && !(await confirmBeforeLeavingDirty())) return;

  if (!state.authenticated) {
    const memo = state.guestMemos.find((item) => item.id === id);
    if (!memo) return;
    state.current = { ...memo };
    state.dirty = false;

    writeEditor(state.current);
    renderMemoList();
    renderRecovery();
    renderPreview();
    await loadHistory();
    setStatus("체험 모드");
    afterMemoOpened();
    if (!skipRoute && !state.isApplyingRoute) writeRoute({ page: "editor", memoId: memo.id });
    return;
  }

  const data = await api(`/api/memos/${encodeURIComponent(id)}`);
  state.current = data.memo;
  state.dirty = false;

  writeEditor(data.memo);
  renderMemoList();
  renderRecovery();
  renderPreview();
  await loadHistory();
  setStatus(data.memo.has_autosave ? "복구본 있음" : "열림");
  afterMemoOpened();
  if (!skipRoute && !state.isApplyingRoute) writeRoute({ page: "editor", memoId: data.memo.id });
}

function afterMemoOpened() {
  renderMobileChrome();
  if (state.route.page !== "list") {
    state.sidebarCollapsed = true;
    state.inspectorCollapsed = true;
    applyLayout();
  }
}

function writeEditor(memo) {
  elements.titleInput.value = memo.title || "";
  renderFolderPicker(memo.folder || "");
  elements.tagsInput.value = (memo.tags || []).join(", ");
  elements.contentInput.value = isStartGuideMemo(memo)
    ? cleanStartGuideContent(memo.content || "")
    : memo.content || "";
  elements.commitMessageInput.value = "";
  elements.updatedLabel.textContent = memo.updated_at ? `업데이트 ${formatDate(memo.updated_at)}` : "";
  renderStartGuideAction();
  renderMobileChrome();
}

function isStartGuideMemo(memo = state.current) {
  const title = memo?.title ?? elements.titleInput?.value ?? "";
  return START_GUIDE_TITLE_PATTERN.test(String(title || ""));
}

function isEditingStartGuide() {
  if (!state.current) return false;
  return START_GUIDE_TITLE_PATTERN.test(String(elements.titleInput.value || state.current.title || ""));
}

function cleanStartGuideContent(content) {
  return String(content || "")
    .replace(START_GUIDE_TUTORIAL_LINK_PATTERN, "")
    .replace(START_GUIDE_LINK_NOTE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

function renderStartGuideAction() {
  elements.startGuideAction.classList.toggle("hidden", !isEditingStartGuide());
}

function renderRecovery() {
  elements.recoveryBanner.classList.toggle("hidden", !state.current?.has_autosave);
}

function loadAutosaveIntoEditor() {
  if (!state.current?.autosave) return;
  writeEditor(state.current.autosave);
  state.dirty = true;
  elements.recoveryBanner.classList.add("hidden");
  renderPreview();
  setStatus("자동 저장본 불러옴");
}

async function discardAutosave() {
  if (!state.current) return;
  if (!state.authenticated) {
    elements.recoveryBanner.classList.add("hidden");
    setStatus("체험 모드에서는 복구본이 생성되지 않습니다.");
    return;
  }
  const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/autosave`, {
    method: "DELETE"
  });
  state.current = data.memo;
  state.dirty = false;
  writeEditor(state.current);
  renderRecovery();
  renderPreview();
  setStatus("자동 저장본 삭제됨");
  await loadMemos();
}

function confirmBeforeLeavingDirty() {
  if (!state.dirty || !state.current) return Promise.resolve(true);
  if (state.pendingUnsavedPrompt) return state.pendingUnsavedPrompt;

  state.pendingUnsavedPrompt = new Promise((resolve) => {
    state.pendingUnsavedResolve = resolve;
    if (!elements.unsavedDialog.open) elements.unsavedDialog.showModal();
    window.setTimeout(() => elements.saveUnsavedButton.focus(), 0);
  }).finally(() => {
    state.pendingUnsavedPrompt = null;
    state.pendingUnsavedResolve = null;
  });

  return state.pendingUnsavedPrompt;
}

function finishUnsavedPrompt(result) {
  if (elements.unsavedDialog.open) elements.unsavedDialog.close();
  state.pendingUnsavedResolve?.(Boolean(result));
}

function saveUnsavedAndContinue() {
  if (!state.pendingUnsavedResolve) return;
  if (elements.unsavedDialog.open) elements.unsavedDialog.close();
  requestSaveCurrentMemo({
    onSaved: () => finishUnsavedPrompt(true),
    onCancelled: () => finishUnsavedPrompt(false)
  });
}

async function discardUnsavedAndContinue() {
  if (!state.pendingUnsavedResolve) return;
  try {
    await discardCurrentEditsAndAutosave();
    finishUnsavedPrompt(true);
  } catch (error) {
    setStatus(error.message || "수정사항을 버릴 수 없습니다.");
    finishUnsavedPrompt(false);
  }
}

async function discardCurrentEditsAndAutosave() {
  if (!state.current) return;
  clearTimeout(state.autosaveTimer);

  if (!state.authenticated) {
    const memo = state.guestMemos.find((item) => item.id === state.current.id);
    if (memo) {
      state.current = { ...memo };
      writeEditor(state.current);
      renderPreview();
      loadGuestMemos();
      await loadHistory();
    }
    state.dirty = false;
    renderRecovery();
    setStatus("수정사항 버림");
    return;
  }

  const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/autosave`, {
    method: "DELETE"
  });
  state.current = data.memo;
  state.dirty = false;
  writeEditor(state.current);
  renderRecovery();
  renderPreview();
  setStatus("수정사항 버림");
  await loadMemos();
  await loadHistory();
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  if (!state.authenticated) return;
  if (!state.user?.is_autosave_enabled) return;
  state.autosaveTimer = setTimeout(autosaveCurrentMemo, 3000);
}

async function autosaveCurrentMemo() {
  if (!state.authenticated) return;
  if (!state.current || !state.user?.is_autosave_enabled) return;
  clearTimeout(state.autosaveTimer);
  const wasDirty = state.dirty;

  try {
    const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/autosave`, {
      method: "PUT",
      body: editorPayload()
    });
    if (data.skipped) return;
    state.current = { ...state.current, has_autosave: true, autosave: data.memo?.autosave || data.memo };
    state.dirty = wasDirty;
    setStatus("복구본 자동 저장됨 · 아직 Git 기록 아님");
    await loadMemos();
  } catch (error) {
    state.dirty = true;
    setStatus(error.message || "자동 저장에 실패했습니다.");
  }
}

function requestSaveCurrentMemo(options = {}) {
  if (options instanceof Event) options = {};
  if (options.onSaved || options.onCancelled) state.pendingSaveAction = options;
  if (!state.current) {
    finishPendingSave(false);
    return;
  }
  if (!state.authenticated) {
    openDownloadDialog();
    return;
  }

  elements.commitMessageInput.value = "";
  if (!elements.commitDialog.open) elements.commitDialog.showModal();
  window.setTimeout(() => elements.commitMessageInput.focus(), 0);
}

function closeCommitDialog(options = {}) {
  if (options instanceof Event) options = {};
  if (elements.commitDialog.open) elements.commitDialog.close();
  if (!options.completed) finishPendingSave(false);
}

async function confirmCommitSave() {
  const message = elements.commitMessageInput.value;
  closeCommitDialog({ completed: true });
  try {
    const saved = await saveCurrentMemo(message);
    finishPendingSave(Boolean(saved));
  } catch (error) {
    setStatus(error.message || "저장할 수 없습니다.");
    finishPendingSave(false);
  }
}

function openDownloadDialog() {
  if (!elements.downloadDialog.open) elements.downloadDialog.showModal();
  window.setTimeout(() => elements.confirmDownloadButton.focus(), 0);
}

function closeDownloadDialog(options = {}) {
  if (options instanceof Event) options = {};
  if (elements.downloadDialog.open) elements.downloadDialog.close();
  if (!options.completed) finishPendingSave(false);
}

async function confirmDownloadSave() {
  closeDownloadDialog({ completed: true });
  try {
    const saved = await saveCurrentMemo();
    finishPendingSave(Boolean(saved));
  } catch (error) {
    setStatus(error.message || "저장할 수 없습니다.");
    finishPendingSave(false);
  }
}

function finishPendingSave(completed) {
  const pending = state.pendingSaveAction;
  if (!pending) return;
  state.pendingSaveAction = null;
  if (completed) pending.onSaved?.();
  else pending.onCancelled?.();
}

async function saveCurrentMemo(message = "") {
  if (!state.current) return false;
  clearTimeout(state.autosaveTimer);

  if (!state.authenticated) {
    const memo = syncGuestCurrentFromEditor({ touchUpdatedAt: true });
    if (!memo) return false;
    state.dirty = false;
    writeEditor(memo);
    renderPreview();
    loadGuestMemos();
    await loadHistory();
    downloadMarkdown(memo);
    setStatus(".md 파일로 다운로드됨");
    return true;
  }

  setStatus("저장 중");

  const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/commit`, {
    method: "POST",
    body: {
      ...editorPayload(),
      message
    }
  });

  state.current = data.memo;
  state.dirty = false;
  elements.commitMessageInput.value = "";
  writeEditor(state.current);
  renderRecovery();
  renderPreview();
  setStatus(data.commit?.committed ? "Git 기록으로 저장됨" : "변경 없음");
  await loadMemos();
  await loadHistory();
  return true;
}

function editorPayload() {
  return {
    title: elements.titleInput.value,
    folder: state.selectedFolder,
    tags: elements.tagsInput.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    content: elements.contentInput.value
  };
}

function syncGuestCurrentFromEditor({ touchUpdatedAt = false } = {}) {
  if (!state.current) return null;
  const payload = editorPayload();
  const index = state.guestMemos.findIndex((memo) => memo.id === state.current.id);
  if (index === -1) return null;

  const existing = state.guestMemos[index];
  const next = {
    ...existing,
    ...payload,
    title: payload.title.trim() || "Untitled",
    updated_at: touchUpdatedAt ? new Date().toISOString() : existing.updated_at,
    excerpt: memoExcerpt(payload.content)
  };
  state.guestMemos[index] = next;
  state.current = { ...next };
  return state.current;
}

function createGuestId() {
  if (globalThis.crypto?.randomUUID) return `guest-${globalThis.crypto.randomUUID()}`;
  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextGuestMemoPosition(folder) {
  const positions = state.guestMemos
    .filter((memo) => (memo.folder || "") === (folder || ""))
    .map((memo) => Number(memo.position || 0));
  return positions.length ? Math.max(...positions) + 1 : 1;
}

function downloadMarkdown(memo) {
  const markdown = buildMemoMarkdown(memo);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(memo.title || "memo")}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildMemoMarkdown(memo) {
  const cleanTitle = String(memo.title || "Untitled").trim() || "Untitled";
  const lines = [
    "---",
    `id: ${memo.id}`,
    `title: ${JSON.stringify(cleanTitle)}`,
    `tags: ${JSON.stringify(memo.tags || [])}`,
    `created_at: ${JSON.stringify(memo.created_at || new Date().toISOString())}`,
    `updated_at: ${JSON.stringify(memo.updated_at || new Date().toISOString())}`
  ];

  if (memo.folder) lines.push(`folder: ${JSON.stringify(memo.folder)}`);
  if (memo.trashed_at) lines.push(`trashed_at: ${JSON.stringify(memo.trashed_at)}`);
  if (memo.original_folder) lines.push(`original_folder: ${JSON.stringify(memo.original_folder)}`);
  if (memo.pinned) lines.push("pinned: true");
  if (Number.isFinite(Number(memo.position)) && Number(memo.position) > 0) {
    lines.push(`position: ${Number(memo.position)}`);
  }

  lines.push("---", memo.content || "");
  return lines.join("\n");
}

function sanitizeFileName(name) {
  const clean = String(name || "memo")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return clean || "memo";
}

function titleFromImportedFile(name) {
  const clean = String(name || "memo.txt")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "가져온 메모";
}

async function loadHistory() {
  if (!state.current) return;
  if (!state.authenticated) {
    const empty = `
      <li class="history-item">
        <span>로그인 후 저장하면 Git 히스토리를 사용할 수 있습니다.</span>
      </li>
    `;
    elements.historyList.innerHTML = empty;
    elements.floatingHistoryList.innerHTML = empty;
    elements.historyDialogMeta.textContent = "로그인 후 저장하면 Git 히스토리를 사용할 수 있습니다.";
    return;
  }
  const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/history`);
  renderHistoryItems(elements.historyList, data.history);
  renderHistoryItems(elements.floatingHistoryList, data.history);
  elements.historyDialogMeta.textContent = `${state.current.title || "제목 없음"} · ${data.history.length}개 버전`;
}

function renderHistoryItems(target, history) {
  target.innerHTML = "";
  for (const item of history || []) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.tabIndex = 0;
    li.innerHTML = `
      <code>${item.hash.slice(0, 10)}</code>
      <time>${formatDate(item.date)}</time>
      <span>${escapeHtml(item.subject)}</span>
      <div class="history-actions">
        <button type="button" class="view-btn">보기</button>
        <button type="button" class="restore-btn">복원</button>
        <button type="button" class="delete-btn">삭제</button>
      </div>
    `;
    li.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openHistoryVersion(item.hash, "raw");
    });
    li.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openHistoryVersion(item.hash, "raw");
    });
    li.querySelector(".view-btn").addEventListener("click", () => openHistoryVersion(item.hash, "raw"));
    li.querySelector(".restore-btn").addEventListener("click", () => restoreVersion(item.hash));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteHistory(item.hash));
    target.appendChild(li);
  }
}

async function openHistoryDialog() {
  if (!state.current) {
    setStatus("열린 메모가 없습니다.");
    return;
  }
  await loadHistory();
  if (!elements.historyDialog.open) elements.historyDialog.showModal();
  renderMobileChrome();
}

async function openHistoryVersion(hash, mode = "raw") {
  if (!state.current) return;
  if (!state.authenticated) {
    setStatus("히스토리는 로그인 후 사용할 수 있습니다.");
    return;
  }

  setStatus("히스토리 불러오는 중");
  try {
    const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/history/${encodeURIComponent(hash)}`);
    renderHistoryDetail(data, mode);
    setStatus("히스토리 열림");
  } catch (error) {
    setStatus(error.message);
  }
}

function renderHistoryDetail(data, mode) {
  const commit = data.commit || {};
  elements.historyDetailTitle.textContent = `${String(commit.hash || "").slice(0, 10)} 원본`;
  elements.historyDetailMeta.textContent = [formatDate(commit.date), commit.subject].filter(Boolean).join(" · ");
  elements.historyRawContent.textContent = data.markdown || "";
  renderHistoryDiff(data.markdown || "");
  setHistoryDetailMode(mode);
  if (!elements.historyDetailDialog.open) elements.historyDetailDialog.showModal();
}

function setHistoryDetailMode(mode) {
  const showDiff = mode === "diff";
  elements.historyRawTab.classList.toggle("active", !showDiff);
  elements.historyDiffTab.classList.toggle("active", showDiff);
  elements.historyRawPanel.classList.toggle("active", !showDiff);
  elements.historyDiffPanel.classList.toggle("active", showDiff);
}

function closeHistoryDetailDialog() {
  if (elements.historyDetailDialog.open) elements.historyDetailDialog.close();
}

function renderHistoryDiff(historyMarkdown) {
  elements.historyDiffContent.innerHTML = "";
  const currentMarkdown = currentEditorMarkdown();
  const diff = diffLines(historyMarkdown, currentMarkdown);
  const changed = diff.some((line) => line.type !== "same");

  if (!changed) {
    const empty = document.createElement("div");
    empty.className = "history-diff-empty";
    empty.textContent = "현재 글과 다른 점이 없습니다.";
    elements.historyDiffContent.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  let oldLine = 1;
  let newLine = 1;
  for (const line of diff) {
    const row = document.createElement("div");
    row.className = `history-diff-line ${line.type === "add" ? "added" : (line.type === "remove" ? "removed" : "same")}`;

    const oldNumber = document.createElement("span");
    oldNumber.className = "diff-line-number";
    oldNumber.textContent = line.type === "add" ? "" : oldLine;

    const newNumber = document.createElement("span");
    newNumber.className = "diff-line-number";
    newNumber.textContent = line.type === "remove" ? "" : newLine;

    const marker = document.createElement("span");
    marker.className = "diff-marker";
    marker.textContent = line.type === "add" ? "+" : (line.type === "remove" ? "-" : " ");

    const content = document.createElement("code");
    content.textContent = line.text || " ";

    row.append(oldNumber, newNumber, marker, content);
    fragment.appendChild(row);

    if (line.type !== "add") oldLine += 1;
    if (line.type !== "remove") newLine += 1;
  }

  elements.historyDiffContent.appendChild(fragment);
}

function currentEditorMarkdown() {
  return buildMemoMarkdown({
    ...state.current,
    ...editorPayload(),
    id: state.current?.id,
    created_at: state.current?.created_at,
    updated_at: state.current?.updated_at,
    pinned: state.current?.pinned,
    position: state.current?.position
  });
}

function diffLines(before, after) {
  const left = String(before || "").split(/\r?\n/);
  const right = String(after || "").split(/\r?\n/);
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const output = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      output.push({ type: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      output.push({ type: "remove", text: left[i] });
      i += 1;
    } else {
      output.push({ type: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) {
    output.push({ type: "remove", text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    output.push({ type: "add", text: right[j] });
    j += 1;
  }
  return output;
}

async function deleteHistory(hash) {
  if (!state.current) return;
  if (!state.authenticated) {
    setStatus("히스토리는 로그인 후 사용할 수 있습니다.");
    return;
  }
  if (!window.confirm("이 커밋을 Git 히스토리에서 완전히 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;

  await api(`/api/memos/${encodeURIComponent(state.current.id)}/history/${encodeURIComponent(hash)}`, {
    method: "DELETE"
  });

  setStatus("커밋 하드 삭제됨");
  await loadHistory();
}

async function deleteCurrentMemo() {
  if (state.current) await deleteMemoById(state.current.id);
}

async function deleteMemoById(id) {
  if (!id) return;
  const memo = state.memos.find((item) => item.id === id);
  const label = memo?.title ? `「${memo.title}」 메모를 정말 삭제하시겠습니까? (영구 삭제)` : "이 메모를 정말 삭제하시겠습니까? (영구 삭제)";
  if (!window.confirm(label)) return;

  if (!state.authenticated) {
    const deletedCurrent = state.current?.id === id;
    state.guestMemos = state.guestMemos.filter((item) => item.id !== id);
    if (deletedCurrent) {
      state.current = null;
      state.dirty = false;
    }
    loadGuestMemos();
    setStatus("체험 메모 삭제됨");

    if (!deletedCurrent) return;
    if (state.guestMemos[0]) {
      await openMemo(state.guestMemos[0].id);
    } else {
      await createMemo();
    }
    return;
  }

  await api(`/api/memos/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  const deletedCurrent = state.current?.id === id;
  if (deletedCurrent) {
    state.current = null;
    state.dirty = false;
  }
  setStatus("메모 삭제됨");
  await loadMemos();

  if (!deletedCurrent) return;

  if (state.memos[0]) {
    await openMemo(state.memos[0].id);
  } else {
    elements.titleInput.value = "";
    renderFolderPicker("");
    elements.tagsInput.value = "";
    elements.contentInput.value = "";
    elements.commitMessageInput.value = "";
    renderStartGuideAction();
    elements.preview.innerHTML = "";
    elements.inlinePreview.innerHTML = "";
    elements.historyList.innerHTML = "";
    setStatus("준비됨");
    navigateToList();
  }
}

async function restoreVersion(hash) {
  if (!state.current) return;
  if (!state.authenticated) {
    setStatus("복원은 로그인 후 사용할 수 있습니다.");
    return;
  }
  const ok = window.confirm("이 버전의 내용을 현재 메모로 복원할까요?");
  if (!ok) return;

  const data = await api(`/api/memos/${encodeURIComponent(state.current.id)}/restore`, {
    method: "POST",
    body: { commit: hash }
  });
  state.current = data.memo;
  state.dirty = false;
  writeEditor(state.current);
  renderRecovery();
  renderPreview();
  setStatus("복원됨");
  await loadMemos();
  await loadHistory();
}

async function uploadSelectedImage() {
  const file = elements.imageInput.files?.[0];
  elements.imageInput.value = "";
  if (!file) return;
  await insertImage(file);
}

async function handlePaste(event) {
  const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
  if (item) {
    event.preventDefault();
    const file = item.getAsFile();
    if (file) await insertImage(file);
    return;
  }

  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text.includes("data:image/")) return;

  event.preventDefault();
  const handled = await insertPastedDataImages(text);
  if (!handled) insertAtCursor(elements.contentInput, text);
}

async function handleDroppedFiles(files) {
  if (!files.length) return;
  const imageFiles = files.filter(isImageFile);
  const textFiles = files.filter((file) => isTextImportFile(file));
  const unsupportedCount = files.length - imageFiles.length - textFiles.length;

  if (unsupportedCount > 0) {
    setStatus(`${unsupportedCount}개 파일은 지원하지 않는 형식입니다.`);
  }

  if (imageFiles.length) {
    for (const imageFile of imageFiles) {
      await insertImage(imageFile);
    }
  }

  if (textFiles.length) {
    await importTextFilesFromFiles(textFiles);
  }
}

async function importSelectedTextFiles() {
  const selectedFiles = [...(elements.textImportInput.files || [])];
  elements.textImportInput.value = "";
  if (!selectedFiles.length) return;
  const files = selectedFiles.filter(isTextImportFile);
  const unsupportedCount = selectedFiles.length - files.length;
  if (unsupportedCount > 0) {
    setStatus(`${unsupportedCount}개 파일은 지원하지 않는 형식입니다.`);
  }
  if (!files.length) return;
  await importTextFilesFromFiles(files);
}

async function importTextFilesFromFiles(files) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > TEXT_IMPORT_TOTAL_LIMIT_BYTES) {
    setStatus(`텍스트 파일은 한 번에 ${formatBytes(TEXT_IMPORT_TOTAL_LIMIT_BYTES)}까지 가져올 수 있습니다.`);
    return;
  }

  setStatus("텍스트 파일 가져오는 중");
  try {
    const payloadFiles = await Promise.all(files.map(async (file) => ({
      name: file.name || "memo.txt",
      content: await readFileAsText(file)
    })));

    if (!state.authenticated) {
      importGuestTextFiles(payloadFiles);
      return;
    }

    const result = await api("/api/import/text", {
      method: "POST",
      body: {
        folder: state.selectedFolder || "",
        files: payloadFiles
      }
    });
    await loadMemos();
    if (result.memos?.[0]) await openMemo(result.memos[0].id);
    setStatus(`${result.count || payloadFiles.length}개 텍스트 파일 가져옴`);
  } catch (error) {
    setStatus(error.message);
  }
}

function isTextImportFile(file) {
  if (file.type.startsWith("text/")) return true;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  return Boolean(extension && TEXT_IMPORT_EXTENSIONS.has(extension));
}

function importGuestTextFiles(files) {
  ensureGuestData();
  if (state.dirty) syncGuestCurrentFromEditor();
  const now = new Date().toISOString();
  const folder = state.selectedFolder || "";
  const imported = files.map((file, index) => ({
    id: createGuestId(),
    title: titleFromImportedFile(file.name),
    folder,
    tags: [],
    pinned: false,
    position: nextGuestMemoPosition(folder) + index,
    created_at: now,
    updated_at: now,
    content: file.content || ""
  }));

  state.guestMemos.push(...imported);
  loadGuestMemos();
  if (imported[0]) openMemo(imported[0].id);
  setStatus(`${imported.length}개 텍스트 파일 가져옴`);
}

async function insertImage(file) {
  const prepared = await prepareImageForInsert(file);
  if (!state.authenticated) {
    const guest = registerGuestAttachment(prepared.file, prepared.filename || file.name || "image.webp");
    insertAtCursor(elements.contentInput, `![${markdownAltText(file.name || prepared.filename)}](${guest.url})`);
    state.dirty = true;
    elements.recoveryBanner.classList.add("hidden");
    renderPreview();
    setStatus(prepared.compressed
      ? `체험 모드 임시 이미지 압축 삽입됨 (${formatBytes(prepared.originalBytes)} → ${formatBytes(prepared.finalBytes)})`
      : "체험 모드 임시 이미지 삽입됨");
    return;
  }

  setStatus("이미지 업로드 중");
  const dataUrl = await readFileAsDataUrl(prepared.file);
  const uploaded = await api("/api/attachments", {
    method: "POST",
    body: {
      filename: prepared.filename,
      data: dataUrl
    }
  });
  insertAtCursor(elements.contentInput, uploaded.embed_markdown || `![${markdownAltText(file.name || prepared.filename)}](${uploaded.markdown_path})`);
  state.dirty = true;
  elements.recoveryBanner.classList.add("hidden");
  renderPreview();
  scheduleAutosave();
  const mediaLabel = uploaded.media_type === "video" ? "움짤이 MP4로 변환됨" : "이미지 최적화됨";
  setStatus(`${mediaLabel} (${formatBytes(uploaded.original_bytes || prepared.originalBytes)} → ${formatBytes(uploaded.stored_bytes || prepared.finalBytes)})`);
}

async function insertPastedDataImages(text) {
  try {
    const matches = [...text.matchAll(DATA_IMAGE_MARKDOWN_PATTERN)].slice(0, 8);
    if (matches.length) {
      for (const match of matches) {
        const file = dataUrlToFile(match[2], match[1] || "pasted-image");
        await insertImage(file);
      }
      if (matches.length === 8) setStatus("이미지를 최대 8개까지 처리했습니다.");
      return true;
    }

    const trimmed = text.trim();
    if (!DATA_IMAGE_URL_PATTERN.test(trimmed)) return false;

    await insertImage(dataUrlToFile(trimmed, "pasted-image"));
    return true;
  } catch {
    setStatus("이미지 붙여넣기 실패");
    return true;
  }
}

function dataUrlToFile(dataUrl, fallbackName) {
  const [header, payload = ""] = String(dataUrl || "").split(",", 2);
  const mime = header.match(/^data:([^;]+);base64$/i)?.[1]?.toLowerCase() || "image/png";
  const extension = mimeToImageExtension(mime);
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  return new File([bytes], ensureImageFilename(fallbackName, extension), { type: mime });
}

function mimeToImageExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

function ensureImageFilename(name, extension) {
  const clean = sanitizeFileName(String(name || "image").replace(/\.[^.]+$/, "")).slice(0, 80) || "image";
  return `${clean}.${extension}`;
}

function markdownAltText(name) {
  return String(name || "image")
    .replace(/\.[^.]+$/, "")
    .replace(/[\[\]\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "image";
}

function registerGuestAttachment(file, filename) {
  const id = `guest-${Date.now().toString(36)}-${(++state.guestAttachmentCounter).toString(36)}`;
  const previous = state.guestAttachments.get(id);
  if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
  const objectUrl = URL.createObjectURL(file);
  state.guestAttachments.set(id, {
    objectUrl,
    filename: filename || "image.webp",
    bytes: file.size || 0
  });
  return { id, url: `chrononote-guest-attachment:${id}` };
}

async function prepareImageForInsert(file) {
  if (!isCompressibleImageFile(file)) {
    return {
      file,
      filename: file.name || "image.png",
      compressed: false,
      originalBytes: file.size || 0,
      finalBytes: file.size || 0
    };
  }

  try {
    const bitmap = await loadImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / bitmap.width, IMAGE_MAX_DIMENSION / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let compressedBlob = null;
    for (const quality of IMAGE_WEBP_QUALITIES) {
      const candidate = await canvasToBlob(canvas, "image/webp", quality);
      if (candidate && candidate.size < file.size) {
        compressedBlob = candidate;
        break;
      }
    }

    if (!compressedBlob) {
      return {
        file,
        filename: file.name || "image.png",
        compressed: false,
        originalBytes: file.size || 0,
        finalBytes: file.size || 0
      };
    }

    return {
      file: compressedBlob,
      filename: replaceFileExtension(file.name || "image", "webp"),
      compressed: true,
      originalBytes: file.size || 0,
      finalBytes: compressedBlob.size || 0
    };
  } catch {
    return {
      file,
      filename: file.name || "image.png",
      compressed: false,
      originalBytes: file.size || 0,
      finalBytes: file.size || 0
    };
  }
}

function isImageFile(file) {
  if (file.type.startsWith("image/")) return true;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  return Boolean(extension && IMAGE_EXTENSIONS.has(extension));
}

function isCompressibleImageFile(file) {
  if (COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return true;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  return extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "webp";
}

async function loadImageBitmap(file) {
  if (globalThis.createImageBitmap) {
    return createImageBitmap(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function replaceFileExtension(filename, extension) {
  const clean = String(filename || "image").replace(/\.[^.]+$/, "");
  return `${clean || "image"}.${extension}`;
}

function insertAtCursor(textarea, value) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n" : "";
  const insert = `${prefix}${value}${suffix}`;
  textarea.value = before + insert + after;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = before.length + insert.length;
}

function renderPreview() {
  const html = markdownToHtml(elements.contentInput.value);
  for (const root of [elements.preview, elements.inlinePreview]) {
    root.innerHTML = html;
    renderStartGuidePreviewAction(root);
    sanitizePreviewStyles(root);
    enhancePreviewMedia(root);
    renderPreviewMath(root);
  }
}

function renderStartGuidePreviewAction(root = elements.preview) {
  if (!isEditingStartGuide()) return;
  const action = document.createElement("p");
  action.className = "guide-preview-action";
  const link = document.createElement("a");
  link.href = "chrononote:tutorial";
  link.textContent = "튜토리얼 시작하기";
  action.append(link);

  const firstHeading = root.querySelector("h1, h2");
  if (firstHeading) {
    firstHeading.after(action);
  } else {
    root.prepend(action);
  }
}

function setEditorMode(mode) {
  state.editorMode = mode === "preview" ? "preview" : "source";
  localStorage.setItem("chrononote.editorMode", state.editorMode);
  elements.appShell.classList.toggle("preview-mode", state.editorMode === "preview");
  elements.appShell.classList.toggle("source-mode", state.editorMode !== "preview");
  elements.contentInput.classList.toggle("hidden", state.editorMode === "preview");
  elements.inlinePreview.classList.toggle("hidden", state.editorMode !== "preview");
  elements.editorModeButton.textContent = state.editorMode === "preview" ? "원본" : "보기";
  elements.editorModeButton.dataset.tooltip = state.editorMode === "preview" ? "원본으로 보기" : "미리보기";
  elements.editorModeButton.setAttribute("aria-label", elements.editorModeButton.dataset.tooltip);
  if (state.editorMode === "preview") renderPreview();
  renderMobileChrome();
}

function setPanel(panel) {
  state.activePanel = panel;
  elements.previewTab.classList.toggle("active", panel === "preview");
  elements.historyTab.classList.toggle("active", panel === "history");
  elements.previewPanel.classList.toggle("active", panel === "preview");
  elements.historyPanel.classList.toggle("active", panel === "history");
  if (state.inspectorCollapsed) setInspectorCollapsed(false);
  renderMobileChrome();
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  localStorage.setItem("chrononote.sidebar", collapsed ? "collapsed" : "open");
  applyLayout();
}

function setInspectorCollapsed(collapsed) {
  state.inspectorCollapsed = collapsed;
  localStorage.setItem("chrononote.inspector", collapsed ? "collapsed" : "open");
  applyLayout();
}

function applyLayout() {
  state.effectiveUiPreference = getEffectiveUiPreference();
  const mobileLayout = state.effectiveUiPreference === "mobile";
  elements.appShell.classList.toggle("mobile-layout", mobileLayout);
  elements.appShell.classList.toggle("desktop-layout", !mobileLayout);
  elements.appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  elements.appShell.classList.toggle("inspector-collapsed", state.inspectorCollapsed);
  elements.sidebarToggleButton.classList.toggle("active", !state.sidebarCollapsed);
  elements.sidebarToggleButton.textContent = state.sidebarCollapsed ? "☰" : "‹";
  elements.sidebarToggleButton.dataset.tooltip = state.sidebarCollapsed ? "사이드바 열기" : "사이드바 접기";
  elements.sidebarToggleButton.setAttribute("aria-label", elements.sidebarToggleButton.dataset.tooltip);
  elements.toggleInspectorButton.textContent = state.inspectorCollapsed ? "▤" : "▥";
  elements.toggleInspectorButton.dataset.tooltip = state.inspectorCollapsed ? "오른쪽 패널 열기" : "오른쪽 패널 접기";
  elements.toggleInspectorButton.setAttribute("aria-label", elements.toggleInspectorButton.dataset.tooltip);
  elements.appShell.style.setProperty("--inspector-width", `${state.inspectorWidth}px`);
  document.documentElement.dataset.uiLayout = state.effectiveUiPreference;
  renderLayoutButtons();
  renderMobileChrome();
}

function isMobileLikeViewport() {
  return window.matchMedia("(max-width: 980px), (max-aspect-ratio: 3/4)").matches;
}

function getEffectiveUiPreference() {
  if (state.uiPreference === "desktop" && !isMobileLikeViewport()) return "desktop";
  return "mobile";
}

function isMobileLayout() {
  return state.effectiveUiPreference === "mobile" || getEffectiveUiPreference() === "mobile";
}

function syncResponsiveLayout() {
  const shouldUseMobileLayout = getEffectiveUiPreference() === "mobile";
  if (shouldUseMobileLayout && !state.inspectorCollapsed) {
    setInspectorCollapsed(true);
  }
  applyLayout();
}

function enterMobileWritingMode() {
  if (!isMobileLayout()) return;
  clearTimeout(state.mobileWritingTimer);
  if (!state.inspectorCollapsed) setInspectorCollapsed(true);
  setSidebarCollapsed(true);
  elements.appShell.classList.add("mobile-writing");
}

function leaveMobileWritingModeSoon() {
  clearTimeout(state.mobileWritingTimer);
  state.mobileWritingTimer = setTimeout(() => {
    if ([elements.titleInput, elements.tagsInput, elements.contentInput].includes(document.activeElement)) return;
    elements.appShell.classList.remove("mobile-writing");
  }, 120);
}

function setUiPreference(uiPreference) {
  state.uiPreference = uiPreference === "desktop" ? "desktop" : "mobile";
  localStorage.setItem("chrononote.uiPreference", state.uiPreference);
  applyLayout();
  syncResponsiveLayout();
  setStatus(state.uiPreference === "desktop" ? "데스크톱 UI 사용" : "모바일 UI 사용");
}

function renderLayoutButtons() {
  elements.mobileLayoutButton.classList.toggle("active", state.uiPreference === "mobile");
  elements.desktopLayoutButton.classList.toggle("active", state.uiPreference === "desktop");
}

function renderMobileChrome() {
  const title = (elements.titleInput?.value || state.current?.title || "ChronoNote").trim() || "제목 없음";
  const folder = isTrashedMemo(state.current) ? "휴지통" : (state.current?.folder || state.selectedFolder || "기본 폴더");
  const subtitle = state.authenticated ? folder : `체험 모드 · ${folder}`;
  elements.mobileTitleLabel.textContent = title;
  elements.mobileSubtitleLabel.textContent = subtitle;
  elements.mobileNotesTab.classList.toggle("active", state.route.page === "list");
  elements.mobileWriteTab.classList.toggle("active", state.route.page === "editor" && state.editorMode !== "preview");
  elements.mobileViewTab.classList.toggle("active", state.route.page === "editor" && state.editorMode === "preview");
  elements.mobileAccountTab.classList.toggle("active", state.route.page === "login");
  elements.mobileSettingsTab.classList.toggle("active", state.route.page === "settings" || state.route.page === "trash");
}

function handleMobileChromeOutsidePointerDown(event) {
  if (!isMobileLayout()) return;
  const target = event.target;
  const clickedSidebar = elements.appShell.querySelector("#sidePanel")?.contains(target);
  const clickedInspector = elements.appShell.querySelector("#inspector")?.contains(target);
  const clickedMobileControl = elements.mobileAppBar.contains(target) || elements.mobileTabBar.contains(target);
  const clickedDialog = target.closest?.("dialog, .folder-icon-popover, .tutorial-overlay");

  if (!state.sidebarCollapsed && !clickedSidebar && !clickedMobileControl && !clickedDialog) {
    setSidebarCollapsed(true);
  }
  if (!state.inspectorCollapsed && !clickedInspector && !clickedMobileControl && !clickedDialog) {
    setInspectorCollapsed(true);
  }
}

function maybeRunEditorLink() {
  if (!state.current || !/시작 가이드/.test(state.current.title || "")) return;
  setTimeout(() => {
    const value = elements.contentInput.value;
    const position = elements.contentInput.selectionStart || 0;
    const lineStart = value.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
    const lineEnd = value.indexOf("\n", position);
    const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
    if (/\]\(chrononote:tutorial\)/.test(line)) startTutorial();
  }, 0);
}

function handlePreviewClick(event) {
  const tutorialLink = event.target.closest?.('a[href="chrononote:tutorial"]');
  if (tutorialLink) {
    event.preventDefault();
    startTutorial();
  }
}

function setThemePreference(themePreference, { persist = true } = {}) {
  state.themePreference = themePreference;
  localStorage.setItem("chrononote.themePreference", themePreference);
  applyTheme();
  renderThemeButtons();

  if (persist && state.user) {
    api("/api/settings", {
      method: "PATCH",
      body: { theme_preference: themePreference }
    })
      .then((data) => {
        state.user = data.user;
        renderUser();
      })
      .catch((error) => setStatus(error.message));
  }
}

function applyTheme() {
  state.resolvedTheme = resolveTheme(state.themePreference);
  document.documentElement.dataset.theme = state.resolvedTheme;
  document.documentElement.dataset.themePreference = state.themePreference;
}

function renderThemeButtons() {
  elements.dialogSystemThemeButton.classList.toggle("active", state.themePreference === "system");
  elements.dialogLightThemeButton.classList.toggle("active", state.themePreference === "light");
  elements.dialogDarkThemeButton.classList.toggle("active", state.themePreference === "dark");
}

function resolveTheme(themePreference) {
  if (themePreference === "dark" || themePreference === "light") return themePreference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function bindTooltips() {
  document.addEventListener("pointerenter", showTooltipSoon, true);
  document.addEventListener("focusin", showTooltipSoon);
  document.addEventListener("pointerleave", hideTooltip, true);
  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("pointerdown", hideTooltip, true);
}

function showTooltipSoon(event) {
  const target = event.target.closest?.("[data-tooltip]");
  if (!target) return;

  clearTimeout(state.tooltipTimer);
  state.tooltipTimer = setTimeout(() => showTooltip(target), 90);
}

function showTooltip(target) {
  const label = target.dataset.tooltip;
  if (!label) return;

  const tooltip = elements.appTooltip;
  tooltip.textContent = label;
  tooltip.classList.add("visible");

  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const preferRight = rect.left < 72;
  const top = preferRight
    ? rect.top + rect.height / 2 - tooltipRect.height / 2
    : rect.top - tooltipRect.height - 8;
  const left = preferRight
    ? rect.right + 10
    : rect.left + rect.width / 2 - tooltipRect.width / 2;

  tooltip.style.top = `${clamp(top, 8, window.innerHeight - tooltipRect.height - 8)}px`;
  tooltip.style.left = `${clamp(left, 8, window.innerWidth - tooltipRect.width - 8)}px`;
}

function hideTooltip() {
  clearTimeout(state.tooltipTimer);
  elements.appTooltip.classList.remove("visible");
}

function bindTutorial() {
  elements.tutorialPrevButton.addEventListener("click", () => showTutorialStep(state.tutorialIndex - 1));
  elements.tutorialNextButton.addEventListener("click", () => {
    if (state.tutorialIndex >= TUTORIAL_STEPS.length - 1) {
      closeTutorial();
      return;
    }
    showTutorialStep(state.tutorialIndex + 1);
  });
  elements.tutorialCloseButton.addEventListener("click", closeTutorial);
  elements.tutorialOverlay.addEventListener("click", (event) => {
    if (event.target === elements.tutorialOverlay) closeTutorial();
  });
  window.addEventListener("resize", () => {
    if (!elements.tutorialOverlay.classList.contains("hidden")) {
      showTutorialStep(state.tutorialIndex, { keepFocus: true });
    }
  });
}

function startTutorial() {
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  if (elements.accountDialog.open) elements.accountDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  state.tutorialIndex = 0;
  elements.tutorialOverlay.classList.remove("hidden");
  showTutorialStep(0);
}

async function showTutorialStep(index, { keepFocus = false } = {}) {
  state.tutorialIndex = clamp(index, 0, TUTORIAL_STEPS.length - 1);
  const step = TUTORIAL_STEPS[state.tutorialIndex];
  await ensureTutorialRoute(step.route);
  const target = document.querySelector(step.target);
  if (target) {
    if (target.closest("#sidebar")) setSidebarCollapsed(false);
    if (target.closest("#inspector")) setInspectorCollapsed(false);
    target.scrollIntoView({ block: "center", inline: "center", behavior: keepFocus ? "auto" : "smooth" });
  }
  elements.tutorialTitle.textContent = step.title;
  elements.tutorialText.textContent = step.text;
  elements.tutorialStepLabel.textContent = `${state.tutorialIndex + 1} / ${TUTORIAL_STEPS.length}`;
  elements.tutorialPrevButton.disabled = state.tutorialIndex === 0;
  elements.tutorialNextButton.textContent = state.tutorialIndex === TUTORIAL_STEPS.length - 1 ? "끝내기" : "다음";
  window.requestAnimationFrame(() => positionTutorial(target));
}

async function ensureTutorialRoute(route) {
  if (!route) return;
  if (route === "settings") {
    openSettingsDialog();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return;
  }

  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  if (elements.accountDialog.open) elements.accountDialog.close();
  state.isApplyingRoute = wasApplyingRoute;

  if (route === "list") {
    await navigateToRoute({ page: "list", memoId: "" }, { replace: true });
  } else if (route === "editor") {
    const memoId = state.current?.id || state.memos[0]?.id;
    if (memoId) await navigateToRoute({ page: "editor", memoId }, { replace: true });
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function closeTutorial() {
  elements.tutorialOverlay.classList.add("hidden");
  elements.tutorialSpotlight.classList.add("hidden");
}

function positionTutorial(target) {
  const margin = 14;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (!target) {
    elements.tutorialSpotlight.classList.add("hidden");
    elements.tutorialCard.style.setProperty("--tutorial-card-left", "50%");
    elements.tutorialCard.style.setProperty("--tutorial-card-top", "50%");
    elements.tutorialCard.style.setProperty("--tutorial-card-transform", "translate(-50%, -50%)");
    return;
  }

  const rect = target.getBoundingClientRect();
  const spotlightLeft = clamp(rect.left - 6, 8, viewportWidth - 24);
  const spotlightTop = clamp(rect.top - 6, 8, viewportHeight - 24);
  const spotlightWidth = clamp(rect.width + 12, 28, viewportWidth - spotlightLeft - 8);
  const spotlightHeight = clamp(rect.height + 12, 28, viewportHeight - spotlightTop - 8);
  elements.tutorialSpotlight.classList.remove("hidden");
  elements.tutorialSpotlight.style.left = `${spotlightLeft}px`;
  elements.tutorialSpotlight.style.top = `${spotlightTop}px`;
  elements.tutorialSpotlight.style.width = `${spotlightWidth}px`;
  elements.tutorialSpotlight.style.height = `${spotlightHeight}px`;

  elements.tutorialCard.style.setProperty("--tutorial-card-transform", "none");
  const cardRect = elements.tutorialCard.getBoundingClientRect();
  const cardWidth = Math.min(cardRect.width || 420, viewportWidth - margin * 2);
  const cardHeight = Math.min(cardRect.height || 240, viewportHeight - margin * 2);
  const preferRight = rect.left + rect.width / 2 < viewportWidth / 2;
  let left = preferRight ? rect.right + margin : rect.left - cardWidth - margin;
  let top = rect.top + rect.height / 2 - cardHeight / 2;

  if (left < margin || left + cardWidth > viewportWidth - margin) {
    left = viewportWidth / 2 - cardWidth / 2;
    top = rect.bottom + margin;
    if (top + cardHeight > viewportHeight - margin) {
      top = rect.top - cardHeight - margin;
    }
  }

  const maxLeft = Math.max(margin, viewportWidth - cardWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - cardHeight - margin);
  elements.tutorialCard.style.setProperty("--tutorial-card-left", `${clamp(left, margin, maxLeft)}px`);
  elements.tutorialCard.style.setProperty("--tutorial-card-top", `${clamp(top, margin, maxTop)}px`);
}

function bindInspectorResize() {
  elements.inspectorResizeHandle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 980px)").matches) return;
    event.preventDefault();
    setInspectorCollapsed(false);
    document.body.classList.add("resizing-inspector");
    elements.inspectorResizeHandle.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      const workspaceRect = document.querySelector(".workspace").getBoundingClientRect();
      const maxWidth = Math.min(720, workspaceRect.width - 360);
      state.inspectorWidth = clamp(workspaceRect.right - moveEvent.clientX, 280, Math.max(280, maxWidth));
      applyLayout();
    };

    const stop = () => {
      localStorage.setItem("chrononote.inspectorWidth", String(Math.round(state.inspectorWidth)));
      document.body.classList.remove("resizing-inspector");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
}

async function openSettingsDialog({ skipRoute = false } = {}) {
  if (!skipRoute && !(await confirmBeforeLeavingDirty())) return false;
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.accountDialog.open) elements.accountDialog.close();
  if (elements.trashDialog.open) elements.trashDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  if (!skipRoute) writeRoute({ page: "settings", memoId: "" });
  renderUser();
  if (!elements.settingsDialog.open) elements.settingsDialog.show();
  await refreshSettingsSummary();
  renderMobileChrome();
  return true;
}

async function refreshSettingsSummary() {
  if (!state.authenticated) {
    elements.storageUsage.textContent = "로그인하면 작업공간 사용량을 확인할 수 있습니다.";
    return;
  }
  elements.storageUsage.textContent = "작업공간 사용량을 확인하는 중…";
  try {
    const data = await api("/api/settings");
    if (data.user) state.user = data.user;
    renderUser();
    renderStorageUsage(data.storage);
  } catch (error) {
    elements.storageUsage.textContent = error.message || "사용량을 확인하지 못했습니다.";
  }
}

function renderStorageUsage(storage) {
  if (!storage) return;
  const used = formatBytes(storage.used_bytes);
  const quota = formatBytes(storage.quota_bytes);
  const percent = storage.quota_bytes
    ? Math.min(100, Math.round((storage.used_bytes / storage.quota_bytes) * 100))
    : 0;
  elements.storageUsage.textContent = `작업공간 ${used} / ${quota} 사용 중 (${percent}%)`;
}

async function openAccountDialog(mode, { skipRoute = false } = {}) {
  if (!skipRoute && !(await confirmBeforeLeavingDirty())) return false;
  if (mode) setAuthMode(mode);
  const wasApplyingRoute = state.isApplyingRoute;
  state.isApplyingRoute = true;
  if (elements.settingsDialog.open) elements.settingsDialog.close();
  if (elements.trashDialog.open) elements.trashDialog.close();
  state.isApplyingRoute = wasApplyingRoute;
  if (!skipRoute) writeRoute({ page: "login", memoId: "" });
  renderUser();
  if (!elements.accountDialog.open) elements.accountDialog.show();
  renderMobileChrome();
  return true;
}

async function saveSettings() {
  if (!state.authenticated) {
    setStatus("계정 설정은 로그인 후 저장할 수 있습니다.");
    return;
  }

  const payload = {
    is_autosave_enabled: elements.autosaveToggle.checked,
    theme_preference: state.themePreference,
    github_sync_repo: elements.githubRepoInput.value.trim()
  };
  if (elements.githubTokenInput.value.trim()) {
    payload.github_sync_token = elements.githubTokenInput.value.trim();
  }

  const data = await api("/api/settings", {
    method: "PATCH",
    body: payload
  });
  state.user = data.user;
  renderStorageUsage(data.storage);
  elements.githubTokenInput.value = "";
  renderUser();
  setStatus("계정 설정 저장됨");
}

async function syncGithub() {
  if (!state.authenticated) {
    openAccountDialog("login");
    setStatus("GitHub 동기화는 로그인 후 사용할 수 있습니다.");
    return;
  }
  setStatus("GitHub 동기화 중");
  try {
    const result = await api("/api/sync/github", { method: "POST" });
    setStatus(`${result.repo} 동기화 완료`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function rebuildIndex() {
  if (!state.authenticated) {
    openAccountDialog("login");
    setStatus("인덱스 재빌드는 로그인 후 사용할 수 있습니다.");
    return;
  }
  setStatus("인덱스 재빌드 중");
  try {
    await api("/api/index/rebuild", { method: "POST" });
    await loadMemos();
    setStatus("인덱스 재빌드 완료");
  } catch (error) {
    setStatus(error.message);
  }
}

async function submitPasswordAuth() {
  const email = elements.authEmailInput.value.trim();
  const password = elements.authPasswordInput.value;
  const passwordConfirm = elements.authPasswordConfirmInput.value;
  const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";

  if (state.authMode === "register" && !updateAuthValidation()) {
    setStatus("가입 정보를 확인해주세요.");
    return;
  }

  setStatus(state.authMode === "register" ? "가입 중" : "로그인 중");

  try {
    const data = await api(path, {
      method: "POST",
      body: {
        email,
        password,
        password_confirm: passwordConfirm,
        terms_accepted: elements.termsConsentCheckbox.checked,
        privacy_accepted: elements.privacyConsentCheckbox.checked,
        age_confirmed: elements.ageConsentCheckbox.checked
      }
    });
    state.user = data.user;
    state.authenticated = true;
    state.csrfToken = data.csrf_token || state.csrfToken;
    elements.authPasswordInput.value = "";
    elements.authPasswordConfirmInput.value = "";
    elements.termsConsentCheckbox.checked = false;
    elements.privacyConsentCheckbox.checked = false;
    elements.ageConsentCheckbox.checked = false;
    renderUser();
    await bootWorkspace();
    if (elements.accountDialog.open) elements.accountDialog.close();
    navigateToList();
    setStatus(state.authMode === "register" ? "가입 완료" : "로그인 완료");
  } catch (error) {
    setStatus(error.message);
    elements.authHint.textContent = error.message;
  }
}

async function submitAccountPassword() {
  if (!state.authenticated) return;
  if (!updateAccountPasswordValidation()) {
    setStatus("비밀번호 입력을 확인해주세요.");
    return;
  }

  setStatus("비밀번호 등록 중");
  try {
    const data = await api("/api/account/password", {
      method: "POST",
      body: {
        password: elements.accountPasswordInput.value,
        password_confirm: elements.accountPasswordConfirmInput.value
      }
    });
    state.user = data.user;
    clearAccountPasswordFields();
    renderUser();
    setStatus("비밀번호 등록 완료");
  } catch (error) {
    setStatus(error.message);
  }
}

async function logout() {
  setStatus("로그아웃 중");
  try {
    await api("/api/auth/logout", { method: "POST" });
    state.current = null;
    state.dirty = false;
    state.csrfToken = null;
    await loadSession();
    renderLoggedOutWorkspace();
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    if (elements.accountDialog.open) elements.accountDialog.close();
    navigateToList();
    setStatus("로그아웃됨");
  } catch (error) {
    setStatus(error.message);
  }
}

function showDeleteAccountPanel() {
  if (!state.user?.has_password) {
    setStatus("비밀번호 계정만 앱에서 탈퇴할 수 있습니다.");
    return;
  }
  hideLogoutConfirmPanel();
  state.deleteAccountOpen = true;
  elements.deleteAccountPanel.classList.remove("hidden");
  elements.deleteAccountEmailInput.value = state.user.email || "";
  elements.deleteAccountPasswordInput.value = "";
  elements.deleteAccountPasswordInput.focus();
}

function hideDeleteAccountPanel() {
  state.deleteAccountOpen = false;
  elements.deleteAccountPanel.classList.add("hidden");
  elements.deleteAccountEmailInput.value = "";
  elements.deleteAccountPasswordInput.value = "";
}

function showLogoutConfirmPanel() {
  if (!state.authenticated) return;
  hideDeleteAccountPanel();
  elements.logoutConfirmPanel.classList.remove("hidden");
  elements.confirmLogoutButton.focus();
}

function hideLogoutConfirmPanel() {
  elements.logoutConfirmPanel.classList.add("hidden");
}

async function deleteAccount() {
  if (!state.authenticated) return;
  setStatus("탈퇴 처리 중");

  try {
    const result = await api("/api/account/delete", {
      method: "POST",
      body: {
        email: elements.deleteAccountEmailInput.value.trim(),
        password: elements.deleteAccountPasswordInput.value
      }
    });
    state.user = null;
    state.authenticated = false;
    state.csrfToken = null;
    state.current = null;
    state.dirty = false;
    hideDeleteAccountPanel();
    renderUser();
    renderLoggedOutWorkspace();
    if (elements.settingsDialog.open) elements.settingsDialog.close();
    if (elements.accountDialog.open) elements.accountDialog.close();
    navigateToList();
    const recoverUntil = result.recover_until ? ` ${formatDate(result.recover_until)}까지 로그인하면 복구할 수 있습니다.` : "";
    setStatus(`탈퇴 대기 처리됨.${recoverUntil}`);
  } catch (error) {
    setStatus(error.message);
  }
}

function setStatus(label) {
  elements.statusLabel.textContent = label;
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = options.body ? { "Content-Type": "application/json" } : {};
  if (state.csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    throw new Error(navigator.onLine
      ? "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."
      : "오프라인입니다. 연결이 복구되면 다시 시도해주세요.", { cause: error });
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("서버 응답을 읽을 수 없습니다.");
  }
  if (!response.ok) {
    throw new Error(data.error || "요청 실패");
  }
  return data;
}

function configurePreviewRenderer() {
  if (!globalThis.DOMPurify || globalThis.__chrononotePurifyConfigured) return;
  globalThis.__chrononotePurifyConfigured = true;
  globalThis.DOMPurify.addHook("uponSanitizeAttribute", (_, data) => {
    const name = data.attrName.toLowerCase();
    if (name.startsWith("on")) {
      data.keepAttr = false;
      return;
    }
    if (name === "href" || name === "src" || name === "poster" || name === "xlink:href") {
      const value = rewriteAttachmentUrl(data.attrValue);
      if (!isSafePreviewUrl(value, name === "src" || name === "poster")) {
        data.keepAttr = false;
        return;
      }
      data.attrValue = value;
    }
    if (["fill", "stroke", "stop-color"].includes(name) && /url\s*\(|javascript:/i.test(data.attrValue)) {
      data.keepAttr = false;
      return;
    }
    if (name === "style") {
      const clean = sanitizeCss(data.attrValue);
      if (!clean) {
        data.keepAttr = false;
        return;
      }
      data.attrValue = clean;
    }
  });
}

function markdownToHtml(markdown) {
  const renderer = globalThis.marked?.parse ? globalThis.marked : globalThis.marked?.marked;
  const rawHtml = renderer?.parse
    ? renderer.parse(markdown, { gfm: true, breaks: false, mangle: false, headerIds: false })
    : fallbackMarkdownToHtml(markdown);
  if (!globalThis.DOMPurify) return fallbackMarkdownToHtml(markdown);

  return globalThis.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, svg: true, svgFilters: false },
    ADD_TAGS: ["video", "source", ...SAFE_SVG_TAGS],
    ADD_ATTR: [
      "style", "controls", "autoplay", "loop", "muted", "playsinline", "poster",
      "target", "rel", "class", "id", "aria-label", "role", ...SAFE_SVG_ATTRS
    ],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "foreignObject", "foreignobject"],
    ALLOW_DATA_ATTR: false
  });
}

function fallbackMarkdownToHtml(markdown) {
  return escapeHtml(markdown)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sanitizePreviewStyles(root) {
  root.querySelectorAll("style").forEach((style) => style.remove());
  root.querySelectorAll("[style]").forEach((element) => {
    const clean = sanitizeCss(element.getAttribute("style") || "");
    if (clean) {
      element.setAttribute("style", clean);
    } else {
      element.removeAttribute("style");
    }
  });
}

function sanitizeCss(css) {
  const value = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!value) return "";
  if (/[{}]|@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript:/i.test(value)) return "";
  const allowed = new Set([
    "align-items", "background", "background-color", "border", "border-color", "border-radius",
    "border-style", "border-width", "box-shadow", "color", "display", "font-size", "font-style",
    "font-weight", "gap", "grid-template-columns", "height", "justify-content", "line-height", "margin",
    "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height", "max-width", "min-height",
    "min-width", "opacity", "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
    "text-align", "text-decoration", "white-space", "width"
  ]);
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator < 1) return "";
      const property = part.slice(0, separator).trim().toLowerCase();
      const declaration = part.slice(separator + 1).trim();
      if (!allowed.has(property) || !declaration || /!important|[<>]/i.test(declaration)) return "";
      return `${property}: ${declaration}`;
    })
    .filter(Boolean)
    .join("; ");
}

function enhancePreviewMedia(root) {
  root.querySelectorAll("img, video, source, a").forEach((element) => {
    for (const attr of ["src", "href"]) {
      if (!element.hasAttribute(attr)) continue;
      const next = rewriteAttachmentUrl(element.getAttribute(attr) || "");
      if (isSafePreviewUrl(next, attr === "src")) {
        element.setAttribute(attr, next);
      } else {
        element.removeAttribute(attr);
      }
    }
  });
  root.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  root.querySelectorAll("video").forEach((video) => {
    video.setAttribute("autoplay", "");
    video.setAttribute("loop", "");
    video.setAttribute("muted", "");
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("controls", "");
  });
}

function renderPreviewMath(root) {
  if (!globalThis.renderMathInElement) return;
  try {
    globalThis.renderMathInElement(root, {
      trust: false,
      throwOnError: false,
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ]
    });
  } catch {
    // KaTeX should never break editing if a formula is malformed.
  }
}

function rewriteAttachmentUrl(src) {
  const value = String(src || "").trim();
  if (value.startsWith("chrononote-guest-attachment:")) {
    const id = value.slice("chrononote-guest-attachment:".length);
    return state.guestAttachments.get(id)?.objectUrl || "";
  }
  if (value.startsWith("../.attachments/")) {
    return `/attachments/${encodeURIComponent(value.slice("../.attachments/".length))}`;
  }
  return value;
}

function isSafePreviewUrl(value, media = false) {
  const url = String(value || "").trim();
  if (!url) return false;
  if (url === "chrononote:tutorial") return true;
  if (url.startsWith("/attachments/")) return true;
  if (media && url.startsWith("blob:")) return true;
  if (media && /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(url)) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
}
