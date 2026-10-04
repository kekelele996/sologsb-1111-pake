# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，并按深度区间编录岩性描述与样品。设计资料与钻探资料分库分管：地质设计组维护设计孔深与设计见矿层位，钻探班组维护回次进尺与终孔报告，季度对账拿设计见矿层位比对实测回次，覆盖不上的孔下发补勘。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

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
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore / designStore / reconStore） |
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
│       ├── types/             # drill-hole / drill-run / core-box / litho-log / design / recon
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore / designStore / reconStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc
│       ├── pages/             # HoleBoard / DesignLedger / HoleList / RunLog / CoreBoxList / LithoEditor / ReconCenter
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / recon.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、未达设计待补勘清单、采取率异常清单（<75% 标红） |
| `/designs` | 设计台账 | 地质设计组资料：设计孔深与设计见矿层位单独登记，只动设计这份；支持按台帐回填缺失设计 |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、设计/终孔深度、测斜数据、回次深度覆盖与岩芯箱数回显 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单 |
| `/boxes` | 岩芯箱编目 | 格位网格按深度填充、破损格标记、装箱深度连续性与格位容量校验 |
| `/lithology` | 岩性编录 | 按深度区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图 |
| `/recon` | 季度对账 | 设计见矿层位比对实测回次，覆盖不上的孔下发补勘；容量排满顺延、空位按序放；中断续跑、失败按设计侧重试 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`designs`、`reconRuns`、`reconItems`、`supplements`、`meta`。
- 两份资料各管各的：`designs` 是地质设计组的设计孔深与设计见矿层位；`holes`/`runs` 是钻探班组的台帐（终孔报告）与回次进尺，两边按孔号对应，谁改了都只动自己那份。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为岩性表增加 `[holeId+fromDepth]` 复合索引并回填历史 RQD；`db.version(3).upgrade(...)` 新增设计台账与对账四张表，旧数据里的孔没有设计见矿层位，升级时按现有设计孔深回填（层位取 0~设计孔深全段）。升级前可用顶栏「导出备份」导出全量 JSON。
- 季度对账（`reconRuns`/`reconItems`）逐孔落库：中断后已比过的孔保留可续跑；覆盖不上的孔写入 `supplements` 补勘任务，容量 `SUPPLEMENT_CAPACITY=2`（`src/utils/recon.ts`），排满顺延、已下发照旧、空位按序补位，下发失败可按设计侧重试。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 设计台账 + 回次 + 岩芯箱 + 岩性区间）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
