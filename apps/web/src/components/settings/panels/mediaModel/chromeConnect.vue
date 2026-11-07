<template>
  <el-collapse class="chromeConnect">
    <el-collapse-item :title="translate('Chrome Connect · Muse, máy khác và VM')" name="chrome">
      <el-button :loading="downloading" @click="downloadExtension">{{ translate("Tải extension Chrome Connect (.zip)") }}</el-button>
      <p>{{ translate("Giải nén ZIP, mở chrome://extensions, bật Chế độ nhà phát triển và chọn Tải tiện ích đã giải nén. Áp dụng cho máy này, máy khác và VM.") }}</p>
      <el-form labelPosition="top" @submit.prevent>
        <el-form-item :label="translate('Địa chỉ relay')"><el-input v-model="relayUrl" placeholder="https://your-relay.onrender.com" /></el-form-item>
        <el-form-item :label="translate('Relay controller token')"><el-input v-model="controllerToken" type="password" showPassword autocomplete="off" /></el-form-item>
        <el-button :loading="busy" @click="saveRelay">{{ translate('Lưu kết nối relay') }}</el-button>
        <el-divider />
        <el-form-item :label="translate('Tên Chrome cần ghép')"><el-input v-model="label" :placeholder="translate('Ví dụ: Chrome máy chính hoặc VM')" /></el-form-item>
        <el-space wrap>
          <el-button :disabled="busy || !label.trim()" @click="createPair">{{ translate('Tạo mã ghép Chrome') }}</el-button>
          <el-button :disabled="busy" @click="refresh">{{ translate('Làm mới thiết bị và tab') }}</el-button>
        </el-space>
        <div v-if="pairingUri" class="pairingCode">
          <p>{{ translate('Dán mã này vào Toonflow Chrome Connect trên Chrome cần ghép. Mã dùng một lần, hết hạn sau 5 phút.') }}</p>
          <el-input :modelValue="pairingUri" readonly type="password" showPassword :aria-label="translate('Mã ghép Chrome')" />
          <el-button text @click="copyPairing">{{ translate('Sao chép mã') }}</el-button>
        </div>
        <el-card v-for="device in devices" :key="device.deviceId" class="chromeDevice" shadow="never">
          <strong>{{ device.label }}</strong>
          <el-text size="small" type="info">{{ device.deviceId }}</el-text>
          <div v-for="tab in device.tabs" :key="tab.id" class="chromeTab">
            <div><span>{{ tab.title || 'Muse' }}</span><small>{{ tab.url }}</small></div>
            <el-button size="small" :disabled="busy" @click="pin(device, tab)">{{ translate('Chọn tab này') }}</el-button>
          </div>
        </el-card>
        <p v-if="selected" class="selection">{{ selected }}</p>
        <el-alert v-if="message" :title="message" type="error" :closable="false" showIcon />
      </el-form>
    </el-collapse-item>
  </el-collapse>
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { translate } from "@toonflow/i18n/vue";
import saveFile from "@/lib/saveFile";
import { settings, saveSettings } from "@/stores/settings";

type Tab = { id: number; title?: string; url: string };
type Device = { deviceId: string; epoch: string; label: string; tabs: Tab[] };
const configs = settings.value.mediaProviderConfigs as Record<string, Record<string, string>> | undefined;
const existing = configs?.museChrome;
const relayUrl = ref(existing?.relayUrl ?? "http://127.0.0.1:4176");
const controllerToken = ref(existing?.controllerToken ?? "");
const label = ref("");
const pairingUri = ref("");
const devices = ref<Device[]>([]);
const message = ref("");
const selected = ref(existing?.conversationUrl ?? "");
const busy = ref(false);
const downloading = ref(false);
async function downloadExtension() {
  if (downloading.value) return;
  downloading.value = true;
  try { await saveFile(() => axios.get<Blob>("/downloads/toonflowChromeConnect.zip", { responseType: "blob" }).then(({ data }) => data), "toonflowChromeConnect.zip"); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "Không tải được extension"); }
  finally { downloading.value = false; }
}
const headers = { "x-toonflow-workspace": "1" };

async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; message.value = "";
  try { await action(); }
  catch (error) { message.value = axios.isAxiosError(error) ? error.response?.data?.message ?? error.message : error instanceof Error ? error.message : translate("Kết nối thất bại"); }
  finally { busy.value = false; }
}
async function save(patch: Record<string, string>) {
  await saveSettings(current => {
    const providers = current.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
    return { mediaProviderConfigs: { ...providers, museChrome: { ...providers?.museChrome, ...patch } } };
  });
}
async function saveRelay() {
  await run(async () => {
    await save({ relayUrl: relayUrl.value.trim(), controllerToken: controllerToken.value });
    ElMessage.success(translate("Đã lưu relay"));
  });
}
async function createPair() {
  await run(async () => {
    const { data } = await axios.post("/api/chrome/pair", { label: label.value.trim() }, { headers });
    pairingUri.value = data.data.pairingUri;
  });
}
async function refresh() {
  await run(async () => { const { data } = await axios.get("/api/chrome/devices", { headers }); devices.value = data.data; });
}
async function pin(device: Device, tab: Tab) {
  await run(async () => {
    await save({ deviceId: device.deviceId, epoch: device.epoch, tabId: String(tab.id), conversationUrl: tab.url });
    selected.value = `${device.label} · ${tab.title ?? 'Muse'} · ${tab.url}`;
    ElMessage.success(translate("Đã chọn tab cho các tác vụ Muse mới"));
  });
}
async function copyPairing() {
  await run(async () => { await navigator.clipboard.writeText(pairingUri.value); ElMessage.success(translate("Đã sao chép mã ghép")); });
}
</script>

<style scoped lang="scss">
.chromeConnect { margin-bottom: 18px; .pairingCode { margin-top: 16px; } .chromeDevice { margin-top: 14px; strong { display: block; } } .chromeTab { display: flex; gap: 14px; align-items: center; justify-content: space-between; margin-top: 12px; div { min-width: 0; } small { display: block; overflow-wrap: anywhere; opacity: .65; } } .selection { overflow-wrap: anywhere; } }
</style>
