import CSQLite
import Foundation

/// Only accessed by WorkspaceStore's actor. No SQL values are interpolated into statements.
final class SQLiteDatabase {
  private var handle: OpaquePointer?
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  init(file: URL) throws {
    guard
      sqlite3_open_v2(
        file.path, &handle, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        == SQLITE_OK
    else {
      let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Không mở được SQLite."
      if let handle { sqlite3_close(handle) }
      handle = nil
      throw MooZError.storage(message)
    }
    sqlite3_busy_timeout(handle, 5_000)
    let version = Int(try rows("PRAGMA user_version").first?.first ?? "0") ?? 0
    guard version <= 1 else {
      throw MooZError.storage("Dữ liệu được tạo bởi bản MooZ mới hơn. Không hạ phiên bản database.")
    }
    try execute("PRAGMA journal_mode=WAL")
    try execute("PRAGMA synchronous=FULL")
    try execute(
      "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(kind,id))"
    )
    try execute(
      "CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, job TEXT NOT NULL, request TEXT NOT NULL)"
    )
    try execute(
      "CREATE TABLE IF NOT EXISTS cooldowns (resource TEXT PRIMARY KEY, until REAL NOT NULL)")
    if version == 0 { try execute("PRAGMA user_version=1") }
  }
  deinit { if let handle { sqlite3_close(handle) } }
  func execute(_ sql: String, values: [String] = []) throws {
    let statement = try prepare(sql, values: values)
    defer { sqlite3_finalize(statement) }
    let status = sqlite3_step(statement)
    guard status == SQLITE_DONE || status == SQLITE_ROW else { throw error() }
  }
  private func prepare(_ sql: String, values: [String]) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw error()
    }
    for (i, value) in values.enumerated() {
      guard sqlite3_bind_text(statement, Int32(i + 1), value, -1, transient) == SQLITE_OK else {
        sqlite3_finalize(statement)
        throw error()
      }
    }
    return statement
  }
  func rows(_ sql: String, values: [String] = []) throws -> [[String]] {
    let statement = try prepare(sql, values: values)
    defer { sqlite3_finalize(statement) }
    var result: [[String]] = []
    while true {
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return result }
      guard status == SQLITE_ROW else { throw error() }
      result.append(
        (0..<sqlite3_column_count(statement)).map { column in
          sqlite3_column_text(statement, column).map { String(cString: $0) } ?? ""
        })
    }
  }
  func transaction<T>(_ work: () throws -> T) throws -> T {
    try execute("BEGIN IMMEDIATE")
    do {
      let result = try work()
      try execute("COMMIT")
      return result
    } catch {
      try? execute("ROLLBACK")
      throw error
    }
  }
  func error() -> MooZError {
    .storage(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite đã đóng.")
  }
}
