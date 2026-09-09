//! 备份保留份数裁剪。
//!
//! 当备份数量超过 `backup_retention_count` 时，删除最旧的备份（文件 + 清单条目）。

use std::fs;
use std::path::{Component, Path};
use tauri::AppHandle;

use crate::service::backup;

/// 词法规范化路径为组件序列：消解 `.`/`..`，保留根/盘符标记，
/// 使绝对/相对形态一致后才可做前缀比较。
///
/// `..` 越出根时被忽略（clamp 在根），避免 `..` 上溯到根之外。
fn lexically_normalize(path: &Path) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !parts.is_empty() {
                    parts.pop();
                }
            }
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::RootDir | Component::Prefix(_) => {
                parts.push(component.as_os_str().to_string_lossy().into_owned());
            }
        }
    }
    parts
}

/// 判断 `candidate` 是否严格位于 `base` 目录之内（词法规范化后比较前缀）。
///
/// 清单里的 `path` 是外部可写入的数据，绝不能直接当作删除目标；任何
/// 不落在此范围内的路径都会被 prune 跳过。
fn is_within(base: &Path, candidate: &Path) -> bool {
    let base_parts = lexically_normalize(base);
    let cand_parts = lexically_normalize(candidate);
    cand_parts.len() > base_parts.len() && cand_parts.starts_with(&base_parts)
}

/// 按保留份数裁剪指定目录下的旧备份（文件 + 清单条目）。
///
/// 纯函数：只读 `backup_dir` 路径，不依赖 AppHandle，便于单元测试。
pub fn prune_backups_in_dir(
    backup_dir: &Path,
    retention_count: u32,
) -> Result<(), String> {
    if retention_count == 0 {
        return Ok(());
    }
    // 与 mod.rs 共用读路径：损坏 / 读错误都要中止，绝不把「读不到」当作空清单
    let mut manifest = backup::read_manifest(backup_dir)
        .map_err(|e| format!("BACKUP_PRUNE_MANIFEST: {e}"))?;
    let backups = &mut manifest.backups;

    if backups.len() <= retention_count as usize {
        return Ok(());
    }

    // 按时间戳升序，保留最新的 retention_count 份
    backups.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    let remove_count = backups.len() - retention_count as usize;
    // 收集要删除的条目（保留完整 JSON 以获取 path），然后从清单移除
    let to_remove: Vec<backup::ManifestEntry> = backups.drain(..remove_count).collect();

    // 写回清单（先写 tmp 再 rename，原子性）
    backup::write_manifest(backup_dir, &manifest)?;

    // 删除文件：只删 backup_dir 内的路径（清单 path 可能被篡改，绝不越界删除）
    for entry in &to_remove {
        let file = Path::new(&entry.path);
        if !is_within(backup_dir, file) {
            log::warn!("[backup] 跳过目录外路径: {}", entry.path);
            continue;
        }
        if file.exists() {
            if let Err(e) = fs::remove_file(file) {
                // 文件删除失败不阻断整体裁剪，仅记录警告
                log::warn!("[backup] 删除旧备份失败: {e} ({})", entry.path);
            }
        }
    }
    Ok(())
}

/// 按保留份数裁剪当前 $DSH_HOME/.backups/ 下的旧备份。
pub fn prune_old_backups(
    app_handle: &AppHandle,
    retention_count: u32,
) -> Result<(), String> {
    let backup_dir = backup::get_backup_dir(app_handle);
    prune_backups_in_dir(&backup_dir, retention_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    /// 在临时目录下构造指定数量的假备份文件 + 清单，返回目录路径。
    fn setup_fake_backups(prefix: &str, count: usize) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dsh-backup-retention-{prefix}-{}-{}",
            std::process::id(),
            count
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut entries = Vec::new();
        for i in 0..count {
            // 时间戳按 i 递增，便于验证「最旧的被删」
            let ts = format!("2026{:010}", i); // 14 位紧凑格式，匹配生产代码
            let file = dir.join(format!("web-{ts}.tar.zst")); // 匹配生产代码 {profile}-{ts} 格式
            let mut f = fs::File::create(&file).unwrap();
            f.write_all(b"dummy").unwrap();
            entries.push(backup::ManifestEntry {
                timestamp: ts,
                profile: "web".to_string(),
                path: file.to_string_lossy().into_owned(),
                size: 5,
                include_credentials: false,
            });
        }

        backup::write_manifest(&dir, &backup::BackupManifest { backups: entries }).unwrap();
        dir
    }

    fn read_manifest_backups(dir: &Path) -> Vec<String> {
        backup::read_manifest(dir)
            .unwrap()
            .backups
            .iter()
            .map(|e| e.timestamp.clone())
            .collect()
    }

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("{prefix}-{}", std::process::id()))
    }

    #[test]
    fn prunes_oldest_backups_beyond_limit() {
        let dir = setup_fake_backups("t5", 5);
        prune_backups_in_dir(&dir, 3).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 3, "5 份备份 retention=3 应剩 3 份");
        // 最旧的 2 个应被删除
        assert!(!remaining.contains(&"20260000000000".to_string()));
        assert!(!remaining.contains(&"20260000000001".to_string()));
        // 文件也应被删除（使用 path 字段）
        assert!(!dir.join("web-20260000000000.tar.zst").exists());
        assert!(!dir.join("web-20260000000001.tar.zst").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_all_within_limit() {
        let dir = setup_fake_backups("t3", 3);
        prune_backups_in_dir(&dir, 10).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 3, "3 份备份 retention=10 应全部保留");
        for i in 0..3 {
            let ts = format!("2026{:010}", i);
            assert!(dir.join(format!("web-{ts}.tar.zst")).exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removes_both_file_and_manifest_entry() {
        let dir = setup_fake_backups("t2", 2);
        prune_backups_in_dir(&dir, 1).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 1);
        // 最旧的被删
        assert!(!dir.join("web-20260000000000.tar.zst").exists());
        // 较新的保留
        assert!(dir.join("web-20260000000001.tar.zst").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn handles_empty_backup_list() {
        let dir = temp_dir("dsh-backup-retention-empty");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        backup::write_manifest(&dir, &backup::BackupManifest { backups: vec![] }).unwrap();

        // 空清单不 panic
        prune_backups_in_dir(&dir, 3).unwrap();
        let remaining = read_manifest_backups(&dir);
        assert!(remaining.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 清单条目 path 指向 backup_dir 之外时，必须拒绝删除
    /// （防清单被篡改后把用户任意文件删掉）。
    #[test]
    fn refuses_to_delete_outside_backup_dir() {
        let dir = setup_fake_backups("outside", 3);
        let outside = std::env::temp_dir().join(format!(
            "dsh-backup-retention-outside-{}",
            std::process::id()
        ));
        fs::write(&outside, b"precious").unwrap();

        // 篡改清单：把最旧条目的 path 指向目录外文件
        let mut manifest = backup::read_manifest(&dir).unwrap();
        manifest.backups[0].path = outside.to_string_lossy().into_owned();
        backup::write_manifest(&dir, &manifest).unwrap();

        prune_backups_in_dir(&dir, 2).unwrap();

        // 目录外文件必须原封不动
        assert!(outside.exists(), "目录外文件不应被删除");
        // 清单里该条目已被移除，但 backup_dir 内文件仍在
        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 2);
        assert!(dir.join("web-20260000000002.tar.zst").exists());
        let _ = fs::remove_dir_all(&outside);
        let _ = fs::remove_dir_all(&dir);
    }

    /// `..` 穿越路径同样被拒。
    #[test]
    fn rejects_dotdot_escape_path() {
        let dir = temp_dir("dsh-backup-retention-dotdot");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let outside = std::env::temp_dir().join(format!(
            "dsh-backup-retention-dotdot-outside-{}",
            std::process::id()
        ));
        fs::write(&outside, b"keep").unwrap();

        // path 用 `..` 逃逸：{dir}/../dsh-...-outside-...
        let escaped = dir.join("..").join(outside.file_name().unwrap());

        // 专门测 is_within 判定
        assert!(!is_within(&dir, &escaped));

        let _ = fs::remove_dir_all(&outside);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 目录内正常路径被接受（防回归）。
    #[test]
    fn accepts_internal_path() {
        let dir = temp_dir("dsh-backup-retention-internal");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(is_within(&dir, &dir.join("web-20260101000000.tar.zst")));
        // 目录本身不算「内」
        assert!(!is_within(&dir, &dir));
        let _ = fs::remove_dir_all(&dir);
    }
}