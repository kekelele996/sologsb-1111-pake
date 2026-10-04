# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21811>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（5 条业务路由 + 404） |
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore / supplementStore） |
| 存储 | IndexedDB（Dexie，库名 `gbdrillcore-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21811
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # drill-hole / drill-run / core-box / litho-log / supplement
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore / supplementStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc
│       ├── pages/             # HoleBoard / HoleList / RunLog / CoreBoxList / LithoEditor / SupplementBoard
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / reconcile.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、见矿层位未覆盖待补勘清单、采取率异常清单（<75% 标红）、补勘钻机占用 |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、**设计孔深与设计见矿层位（地质设计组维护）**、测斜数据、回次深度覆盖与岩芯箱数回显；终孔报告由钻探班组另页登记 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单 |
| `/boxes` | 岩芯箱编目 | 格位网格按深度填充、破损格标记、装箱深度连续性与格位容量校验 |
| `/lithology` | 岩性编录 | 按深度区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图 |
| `/supplements` | 补勘调度 | 季度对账：设计见矿层位比对实测回次，覆盖不上下发补勘；钻机容量有限，排队顺延、空位按序放；对账可中断重试，已比过的孔不重复开单 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`supplements`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为岩性表增加 `[holeId+fromDepth]` 复合索引并回填历史 RQD；`db.version(3).upgrade(...)` 新增 `supplements` 补勘订单表，并为旧数据中没有设计见矿层位的孔按现有设计孔深回填 `designOreFrom/designOreTo`。升级前可用顶栏「导出备份」导出全量 JSON。
- 地质设计组管设计孔深与设计见矿层位，钻探班组管回次进尺与终孔报告，两份资料各管各的、互不串改。
- 季度对账（`/supplements`）以设计见矿层位比对实测回次，层位内有断档即下发补勘；补勘钻机容量 `SUPPLEMENT_CAPACITY`（默认 2 台），已下发占用容量、排满排队顺延、空位按序放；对账可中断重试，已比过的孔留着不重复开单。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 回次 + 岩芯箱 + 岩性区间 + 补勘订单）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
