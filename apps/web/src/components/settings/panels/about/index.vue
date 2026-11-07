<template>
  <div class="aboutLocal">
    <img :src="logoUrl" alt="Toonflow" width="56" height="56" />
    <h3>Toonflow · MooZ</h3>
    <p>v{{ version }} · Bản làm việc cục bộ</p>
    <p>Canvas, kho tài nguyên, tạo video hàng loạt và Chrome Connect.</p>
    <el-alert title="Intel · macOS 13 Ventura" type="info" :closable="false" />
    <p>Dự án và thành phẩm được lưu trên máy. Model API và các tab AI sử dụng tài khoản của bạn trên dịch vụ tương ứng.</p>
    <el-link href="https://github.com/mktminhqpbga-glitch/App-MooZ-Workflow" target="_blank">Mã nguồn và bản dựng</el-link>
    <el-divider />
    <p>Toonflow của HBAI-Ltd (MIT). Bộ lập tác vụ video dựa trên app-mooz (GPL-2.0). Chrome adapter giữ giấy phép riêng. Xem notices và mã nguồn đi kèm bản phân phối.</p>
  </div>
</template>
<script setup lang="ts">
import logoUrl from "@toonflow/assets/logo.svg";
const version = import.meta.env.appVersion;
</script>
<style scoped lang="scss">
.aboutLocal { max-width: 640px; p { line-height: 1.7; color: var(--el-text-color-secondary); } }
</style>
