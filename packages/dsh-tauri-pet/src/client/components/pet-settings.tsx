import type { ChangeEvent, ReactElement } from 'react'
import type { PetListItem, PetSettingsProps, PresetDownloadProgress, PresetPetItem } from '../types'
import { ArrowDownToLine, Icon, Plus, useMountStyle } from 'dsh-tauri-ui/client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PET_DEFAULT_SIZE, PET_SIZE_MAX, PET_SIZE_MIN, PET_SIZE_STEP } from '../constants'
import { text, usePetLocale } from '../locales'
import {
  downloadPresetPet,
  fetchPetList,
  fetchPetStatus,
  fetchPresetDownloadProgress,
  fetchPresetPets,
  hidePet,
  importPet,
  setActivePet,
  setPetEnabled,
  setPetSize,
  showPet,
  updatePresetPet,
} from '../service/pet'
import { beginPetStatusFetch, commitPetStatusFetch, getPetUiSnapshot, setPetsAvailable, setPetStatus, subscribePetUi } from '../store'
import { hasAvailablePets } from '../utils/availability'
import { progressPercent, resolvePresetCardAction, resolvePresetCardUpdate } from '../utils/preset-card'
import petSettingsStyle from './pet-settings.cssr'

/** 预设宠物下载轮询间隔（ms）。 */
const PRESET_DOWNLOAD_POLL_MS = 400

/** 模块级清单缓存：跨组件挂载复用，避免反复打开设置页闪烁（初次仍显示加载占位）。 */
let cachedPresetPets: PresetPetItem[] | null = null
let cachedChatPets: PetListItem[] | null = null
let cachedCodexPets: PetListItem[] | null = null

interface PetCardProps {
  actionLabel: string
  active: boolean
  desc: string
  disabled: boolean
  name: string
  onAction: () => void
  /** 下载进度（仅下载/解压中显示进度条）。 */
  progress?: PresetDownloadProgress | null
  /** 下载尺寸标签（`[number]mb`）。 */
  sizeLabel?: string
  thumbnail?: string
  thumbnailType?: 'gif' | 'spritesheet'
  /** 显示「更新」按钮（已安装且清单提示可更新；位于主动作左侧）。 */
  updateDisabled?: boolean
  updateLabel?: string
  onUpdate?: () => void
}

function PetCard(props: PetCardProps): ReactElement {
  const actionClassName = props.active
    ? 'dshp-pet__card-action dshp-pet__card-actionActive'
    : 'dshp-pet__card-action'
  const updateClassName = 'dshp-pet__card-action dshp-pet__card-actionUpdate'
  const thumbnailClassName = props.thumbnailType === 'spritesheet'
    ? 'dshp-pet__card-thumb dshp-pet__card-thumbSprite'
    : 'dshp-pet__card-thumb'
  const percent = props.progress ? progressPercent(props.progress) : null

  return (
    <div className="dshp-pet__card-item">
      {props.thumbnail
        ? props.thumbnailType === 'spritesheet'
          ? (
              <span className={thumbnailClassName} aria-hidden="true">
                <img src={props.thumbnail} alt="" aria-hidden="true" />
              </span>
            )
          : <img className={thumbnailClassName} src={props.thumbnail} alt="" aria-hidden="true" />
        : <div className="dshp-pet__card-thumb dshp-pet__card-thumbPlaceholder" aria-hidden="true">PET</div>}
      <span className="dshp-pet__card-body">
        <span className="dshp-pet__card-nameRow">
          <span className="dshp-pet__card-name">{props.name}</span>
          {props.sizeLabel ? <span className="dshp-pet__cardsize">{props.sizeLabel}</span> : null}
        </span>
        {props.desc ? <span className="dshp-pet__card-desc">{props.desc}</span> : null}
        {props.progress
          ? (
              <span
                className="dshp-pet__card-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
              >
                <span
                  className={percent === null ? 'dshp-pet__card-progressFill dshp-pet__card-progressIndeterminate' : 'dshp-pet__card-progressFill'}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </span>
            )
          : null}
      </span>
      <span className="dshp-pet__card-actions">
        {/* 更新按钮只受更新自身条件约束（busy/下载中），不继承主动作
            disabled（含已选）：默认宠物已启用时仍必须能更新
            （update_preset_pet 会先停用、替换安装后再重新启用）。 */}
        {props.onUpdate && props.updateLabel !== undefined
          ? (
              <button
                type="button"
                className={updateClassName}
                disabled={props.updateDisabled === true}
                onClick={props.onUpdate}
              >
                {props.updateLabel}
              </button>
            )
          : null}
        <button
          type="button"
          className={actionClassName}
          disabled={props.disabled}
          onClick={props.onAction}
        >
          {props.actionLabel}
        </button>
      </span>
    </div>
  )
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result ?? '')
      const comma = value.indexOf(',')
      resolve(comma >= 0 ? value.slice(comma + 1) : value)
    }
    reader.onerror = () => reject(new Error('PET_FILE_READ_FAILED: failed to read pet archive'))
    reader.readAsDataURL(file)
  })
}

/** 预设宠物卡片右侧动作（已选/下载中/启用/下载），纯状态机见 utils/preset-card。 */
export function presetCardAction(
  item: Pick<PresetPetItem, 'id' | 'installed' | 'phase'>,
  active: string,
  progress: PresetDownloadProgress | null | undefined,
): 'download' | 'downloading' | 'enable' | 'selected' {
  return resolvePresetCardAction(item, active, progress)
}

/** 预设宠物卡片「更新」按钮显隐（已安装且可更新，且非下载中），见 utils/preset-card。 */
export function presetCardUpdate(
  item: Pick<PresetPetItem, 'installed' | 'update_available' | 'phase'>,
  progress: PresetDownloadProgress | null | undefined,
): boolean {
  return resolvePresetCardUpdate(item, progress)
}

export function PetSettings(props: PetSettingsProps): ReactElement {
  useMountStyle(petSettingsStyle, 'dsh-tauri-pet-settings-styles')
  usePetLocale()
  const { status } = useSyncExternalStore(subscribePetUi, getPetUiSnapshot, getPetUiSnapshot)
  const [tab, setTab] = useState<'pets' | 'codex'>('pets')
  // 无缓存（首次挂载）时进入加载态，避免空列表闪烁；有缓存直接渲染、后台静默刷新。
  const [busy, setBusy] = useState(() => cachedPresetPets === null)
  const [error, setError] = useState<string | null>(null)
  const [chatPets, setChatPets] = useState<PetListItem[]>(() => cachedChatPets ?? [])
  const [codexPets, setCodexPets] = useState<PetListItem[]>(() => cachedCodexPets ?? [])
  const [presetPets, setPresetPets] = useState<PresetPetItem[]>(() => cachedPresetPets ?? [])
  /** 各预设宠物下载进度（key = preset id；phase=done/failed 后由轮询清理）。 */
  const [downloads, setDownloads] = useState<Record<string, PresetDownloadProgress>>({})
  const downloadTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const [size, setSize] = useState(status?.pet_size ?? PET_DEFAULT_SIZE)
  const committedSizeRef = useRef<number | null>(null)
  const enabled = Boolean(status?.enabled)
  const visible = Boolean(status?.visible)
  const active = status?.active_pet ?? ''
  const statusSize = status?.pet_size ?? PET_DEFAULT_SIZE

  useEffect(() => {
    if (statusSize !== committedSizeRef.current)
      setSize(statusSize)
  }, [statusSize])

  const refreshPresets = useCallback(async (): Promise<void> => {
    try {
      const [nextPresetPets, nextStatus] = await Promise.all([fetchPresetPets(), fetchPetStatus()])
      cachedPresetPets = nextPresetPets
      setPresetPets(nextPresetPets)
      // 下载完成会改变可用性（未安装→已安装），同步侧栏入口显隐（chat/codex 用缓存清单）。
      setPetsAvailable(hasAvailablePets(nextPresetPets, cachedChatPets ?? [], cachedCodexPets ?? []))
      const revision = beginPetStatusFetch()
      commitPetStatusFetch(revision, nextStatus)
      setPetStatus(nextStatus)
    }
    catch (refreshError) {
      console.error('[dsh-tauri-pet] refresh preset pets failed:', refreshError)
      setError(text('listFailed'))
    }
  }, [])

  /** 轮询下载进度；终态后清理定时器并刷新清单。 */
  const pollPresetDownload = useCallback((id: string): void => {
    if (downloadTimersRef.current[id])
      return
    const timer = setInterval(() => {
      void fetchPresetDownloadProgress(id).then((progress) => {
        setDownloads(previous => ({ ...previous, [id]: progress }))
        if (progress.phase === 'done' || progress.phase === 'failed') {
          if (downloadTimersRef.current[id]) {
            clearInterval(downloadTimersRef.current[id])
            delete downloadTimersRef.current[id]
          }
          if (progress.phase === 'failed')
            setError(progress.error ?? text('downloadFailed'))
          else
            void refreshPresets()
        }
      }).catch(() => {
        if (downloadTimersRef.current[id]) {
          clearInterval(downloadTimersRef.current[id])
          delete downloadTimersRef.current[id]
        }
      })
    }, PRESET_DOWNLOAD_POLL_MS)
    downloadTimersRef.current[id] = timer
  }, [refreshPresets])

  useEffect(() => {
    let cancelled = false
    const revision = beginPetStatusFetch()
    void Promise.all([fetchPetStatus(), fetchPetList('chat'), fetchPetList('codex'), fetchPresetPets()])
      .then(([nextStatus, nextChatPets, nextCodexPets, nextPresetPets]) => {
        if (cancelled)
          return
        commitPetStatusFetch(revision, nextStatus)
        cachedChatPets = nextChatPets
        cachedCodexPets = nextCodexPets
        cachedPresetPets = nextPresetPets
        setChatPets(nextChatPets)
        setCodexPets(nextCodexPets)
        setPresetPets(nextPresetPets)
        // 同步侧栏入口显隐：无任何可用宠物（全新安装）时隐藏入口图标。
        setPetsAvailable(hasAvailablePets(nextPresetPets, nextChatPets, nextCodexPets))
        // 跨挂载恢复进行中的下载：清单 phase 标记 downloading/extracting 的项重新轮询，
        // 避免「返回应用再进设置」丢失进度视图、重复点击触发 PET_PRESET_BUSY。
        // 占位进度先写入 downloads，让不确定进度条在第一次轮询返回前立即出现。
        const resumed: Record<string, PresetDownloadProgress> = {}
        for (const item of nextPresetPets) {
          if (item.phase === 'downloading' || item.phase === 'extracting') {
            resumed[item.id] = { phase: item.phase, received: 0, total: 0 }
            pollPresetDownload(item.id)
          }
        }
        if (Object.keys(resumed).length > 0)
          setDownloads(previous => ({ ...previous, ...resumed }))
      })
      .catch((loadError) => {
        if (cancelled)
          return
        console.error('[dsh-tauri-pet] initial load failed:', loadError)
        setError(text('listFailed'))
      })
      .finally(() => {
        if (!cancelled)
          setBusy(false)
      })
    return () => {
      cancelled = true
      for (const timer of Object.values(downloadTimersRef.current))
        clearInterval(timer)
      downloadTimersRef.current = {}
    }
  }, [pollPresetDownload])

  async function startDownload(id: string): Promise<void> {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await downloadPresetPet(id)
      pollPresetDownload(id)
    }
    catch (downloadError) {
      // PET_PRESET_BUSY：下载已在后台进行（例如清单 phase 尚未刷新、跨挂载竞态）。
      // 恢复轮询接管既有下载，而不是报错或再次触发。
      if (String(downloadError).includes('PET_PRESET_BUSY'))
        pollPresetDownload(id)
      else
        setError(text('downloadFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  /**
   * 更新已安装的预设宠物：走与首次下载完全相同的下载/解压流程（同一进度轮询）。
   * 宿主侧在宠物正在使用时先强制停用，更新结束后自动重新启用（前端无需处理）。
   */
  async function startUpdate(id: string): Promise<void> {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await updatePresetPet(id)
      pollPresetDownload(id)
    }
    catch (updateError) {
      if (String(updateError).includes('PET_PRESET_BUSY'))
        pollPresetDownload(id)
      else
        setError(text('updateFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  /** 启用预设宠物：选择它，并确保桌宠被唤醒（自动触发唤醒）。 */
  async function enablePreset(id: string): Promise<void> {
    if (busy || active === id)
      return
    setBusy(true)
    setError(null)
    try {
      let nextStatus = await setActivePet(id)
      if (!nextStatus.enabled)
        nextStatus = await setPetEnabled(true)
      setPetStatus(nextStatus)
    }
    catch (enableError) {
      console.error('[dsh-tauri-pet] enable preset failed:', enableError)
      setError(text('setPetFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  async function choose(id: string): Promise<void> {
    if (busy || active === id)
      return
    setBusy(true)
    setError(null)
    try {
      setPetStatus(await setActivePet(id))
    }
    catch (chooseError) {
      console.error('[dsh-tauri-pet] choose failed:', chooseError)
      setError(text('setPetFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  async function toggleVisibility(): Promise<void> {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      const nextStatus = !enabled
        ? await setPetEnabled(true)
        : visible
          ? await hidePet()
          : await showPet()
      setPetStatus(nextStatus)
    }
    catch (toggleError) {
      console.error('[dsh-tauri-pet] visibility failed:', toggleError)
      setError(text('toggleFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  async function commitSize(value: number): Promise<void> {
    setError(null)
    try {
      const nextStatus = await setPetSize(value)
      committedSizeRef.current = value
      setPetStatus(nextStatus)
    }
    catch (sizeError) {
      console.error('[dsh-tauri-pet] set size failed:', sizeError)
      setError(text('setSizeFailed'))
    }
  }

  async function createPet(): Promise<void> {
    if (busy)
      return
    setBusy(true)
    setError(null)
    try {
      await props.onCreate(props.close)
    }
    catch (createError) {
      console.error('[dsh-tauri-pet] create session failed:', createError)
      setError(text('createFailed'))
      setBusy(false)
    }
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy)
      return
    setBusy(true)
    setError(null)
    try {
      await importPet(file.name, await readAsBase64(file))
      const nextCodexPets = await fetchPetList('codex')
      cachedCodexPets = nextCodexPets
      setCodexPets(nextCodexPets)
      // 导入成功后本地宠物集合变化，同步侧栏入口显隐。
      setPetsAvailable(hasAvailablePets(cachedPresetPets ?? [], cachedChatPets ?? [], nextCodexPets))
    }
    catch (importError) {
      console.error('[dsh-tauri-pet] import failed:', importError)
      setError(text('importFailed'))
    }
    finally {
      setBusy(false)
    }
  }

  const petsPanel = (
    <>
      {busy && presetPets.length === 0 && chatPets.length === 0
        ? <div className="dshp-pet__loading">{text('loading')}</div>
        : (
            <div className="dshp-pet__cards">
              {presetPets.map((item) => {
                const progress = downloads[item.id] ?? null
                const action = presetCardAction(item, active, progress)
                const downloading = action === 'downloading'
                const canUpdate = resolvePresetCardUpdate(item, progress)
                return (
                  <PetCard
                    key={item.id}
                    thumbnail={item.image ?? undefined}
                    name={item.name}
                    desc={item.desc ?? ''}
                    sizeLabel={item.size_mb != null ? `${Math.round(item.size_mb)}mb` : undefined}
                    progress={downloading ? progress : null}
                    active={action === 'selected'}
                    disabled={busy || downloading || action === 'selected'}
                    actionLabel={action === 'selected' ? text('selected') : action === 'enable' ? text('enable') : downloading ? text('downloading') : text('download')}
                    onAction={() => {
                      if (action === 'enable')
                        void enablePreset(item.id)
                      else if (action === 'download')
                        void startDownload(item.id)
                    }}
                    updateLabel={canUpdate ? text('update') : undefined}
                    updateDisabled={busy || downloading}
                    onUpdate={canUpdate ? () => { void startUpdate(item.id) } : undefined}
                  />
                )
              })}
              {chatPets.map(item => (
                <PetCard
                  key={item.id}
                  thumbnail={item.thumbnail}
                  thumbnailType={item.thumbnail ? 'spritesheet' : undefined}
                  name={item.name}
                  desc={item.description ?? ''}
                  active={active === item.id}
                  disabled={busy || active === item.id}
                  actionLabel={text(active === item.id ? 'selected' : 'select')}
                  onAction={() => { void choose(item.id) }}
                />
              ))}
            </div>
          )}
    </>
  )

  const codexPanel = (
    <div className="dshp-pet__cards">
      {codexPets.length === 0
        ? <div className="dshp-pet__empty">{text('emptyImported')}</div>
        : codexPets.map(item => (
            <PetCard
              key={item.id}
              thumbnail={item.thumbnail}
              thumbnailType={item.thumbnail ? 'spritesheet' : undefined}
              name={item.name}
              desc={item.description ?? ''}
              active={active === item.id}
              disabled={busy || active === item.id}
              actionLabel={text(active === item.id ? 'selected' : 'select')}
              onAction={() => { void choose(item.id) }}
            />
          ))}
    </div>
  )

  return (
    <div className="dshp-pet__page">
      <div className="dshp-pet__tabs">
        <div className="dshp-pet__tab-list" role="tablist" aria-label={text('name')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pets'}
            className={tab === 'pets' ? 'dshp-pet__tab-btn dshp-pet__tab-btnActive' : 'dshp-pet__tab-btn'}
            onClick={() => setTab('pets')}
          >
            Pets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'codex'}
            className={tab === 'codex' ? 'dshp-pet__tab-btn dshp-pet__tab-btnActive' : 'dshp-pet__tab-btn'}
            onClick={() => setTab('codex')}
          >
            Codex
          </button>
        </div>
        <div className="dshp-pet__tab-tools">
          {tab === 'pets'
            ? (
                <>
                  <button type="button" className="dshp-pet__tool-btn" disabled={busy} onClick={() => { void createPet() }}>
                    <Icon as={Plus} />
                    {text('create')}
                  </button>
                  <button type="button" className="dshp-pet__tool-btn" disabled={busy} onClick={() => { void toggleVisibility() }}>
                    {visible ? text('collapsePet') : text('wakePet')}
                  </button>
                </>
              )
            : (
                <label className="dshp-pet__tool-btn" aria-disabled={busy}>
                  <Icon as={ArrowDownToLine} />
                  {text('import')}
                  <input
                    type="file"
                    accept=".zip"
                    hidden
                    disabled={busy}
                    onChange={(event) => { void onImport(event) }}
                  />
                </label>
              )}
        </div>
      </div>
      <p className="dshp-pet__tab-desc">
        {tab === 'pets' ? text('tabInstalledDesc') : text('tabCodexDesc')}
      </p>
      <div className="dshp-pet__divider" role="separator" />
      {tab === 'pets' ? petsPanel : codexPanel}
      {error ? <div className="dshp-pet__error" role="alert">{error}</div> : null}
      <div className="dshp-pet__size-row">
        <span className="dshp-pet__size-label">{text('sizeLabel')}</span>
        <input
          type="range"
          className="dshp-pet__size-slider"
          min={PET_SIZE_MIN}
          max={PET_SIZE_MAX}
          step={PET_SIZE_STEP}
          value={size}
          aria-label={text('sizeLabel')}
          onChange={(event) => {
            const value = Number(event.target.value)
            setSize(value)
            void commitSize(value)
          }}
        />
      </div>
      <p className="dshp-pet__hint">{text('sizeHint')}</p>
    </div>
  )
}
