#if os(macOS)
  import Foundation
  import Security
  import MooZCore

  enum KeychainVault {
    private static func query(_ account: String) -> [String: Any] {
      [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "vn.mooz.native",
        kSecAttrAccount as String: account,
      ]
    }
    static func read(_ account: String) throws -> String {
      var parameters = query(account)
      parameters[kSecReturnData as String] = true
      parameters[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      let status = SecItemCopyMatching(parameters as CFDictionary, &result)
      if status == errSecItemNotFound { return "" }
      guard status == errSecSuccess, let bytes = result as? Data,
        let value = String(data: bytes, encoding: .utf8)
      else { throw MooZError.storage("Không đọc được khóa trong Keychain (\(status)).") }
      return value
    }
    static func save(_ value: String, account: String) throws {
      guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw MooZError.invalid("Khóa API không được trống.")
      }
      let update = [kSecValueData as String: Data(value.utf8)]
      let status = SecItemUpdate(query(account) as CFDictionary, update as CFDictionary)
      if status == errSecItemNotFound {
        var parameters = query(account)
        parameters[kSecValueData as String] = Data(value.utf8)
        parameters[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(parameters as CFDictionary, nil) == errSecSuccess else {
          throw MooZError.storage("Không lưu được API key vào Keychain.")
        }
        return
      }
      guard status == errSecSuccess else {
        throw MooZError.storage("Keychain từ chối cập nhật khóa (\(status)).")
      }
    }
  }
#endif
