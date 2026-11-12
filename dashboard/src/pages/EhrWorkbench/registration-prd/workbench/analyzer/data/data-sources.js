/* 门诊挂号登记 · 数据源聚合入口。各分类独立小文件，均为唯一数据源，纯 JSON 字面量。 */
window.CLINIC_REG_DATA_SOURCES = {
  "apisLegacy": window.CLINIC_REG_APIS_LEGACY || {},
  "apisV2": window.CLINIC_REG_APIS_V2 || {},
  "enums": window.CLINIC_REG_ENUMS || {},
  "dictionaries": window.CLINIC_REG_DICTIONARIES || {},
  "tablesLegacy": window.CLINIC_REG_TABLES_LEGACY || {},
  "tablesV2": window.CLINIC_REG_TABLES_V2 || {},
  "switches": (window.CLINIC_REG_CALL_ANALYSIS_DATA || {}).switches || {},
  "parameters": (window.CLINIC_REG_CALL_ANALYSIS_DATA || {}).parameters || {},
  "renderDataSources": function () {
    const sect = (title, rows, note) => {
      const keys = Object.keys(rows || {});
      if (!keys.length) return '';
      return '<section class="ds-section"><h3>' + title + ' · ' + keys.length + '</h3>' +
        (note ? '<p class="ds-note">' + note + '</p>' : '') +
        '<table class="ds-table"><thead><tr><th>标识</th><th>名称 / 路径</th><th>状态</th><th>说明</th></tr></thead><tbody>' +
        keys.map(k => {
          const r = rows[k];
          const name = r.path ? (r.method ? r.method + ' ' : '') + r.path : (r.name || k);
          return '<tr><td><code>' + k + '</code></td><td>' + name + '</td><td>' + (r.status || 'UNKNOWN') + '</td><td>' + (r.purpose || r.note || r.description || '') + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    };
    return sect('旧版接口（003/020 客户端真实调用）', this.apisLegacy) +
      sect('V2 目标接口', this.apisV2, '全部 PROPOSED：新架构仓库出现 commit/path 后才升级证据。') +
      sect('枚举', this.enums) +
      sect('数据字典', this.dictionaries) +
      sect('旧版数据表', this.tablesLegacy) +
      sect('V2 逻辑表', this.tablesV2) +
      sect('业务开关', this.switches);
  }
};
