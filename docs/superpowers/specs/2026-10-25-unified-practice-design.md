# 统一实训与正式复盘设计

用户已在本会话批准组合方案并要求实施。沿用 Next.js、FastAPI、SQLite。合入 main 的复盘预览及首页凭据提醒，保留 PR #9 的按需 Tips、重置保留模型、Markdown 表格和提交弹窗。第二至四关正式验收保持。

第一关发布独立目录 01-task-v1.1/，课程 ID 01-task、版本 1.1.0、answer_form.kind=reflection。旧 01-task/1.0.0 文件不变，旧实验可继续旧 choice 并明确提示新版本入口。每个实验固定自己的课程版本。新版本通关要求：真实两轮有效运行、改进要求引用、两段完整消息引用、小变式判断；自由解释和改写收集保存但不以字数/关键词或模型结论评分。页面说明通过代表基础操作及结构化核对，不宣称自由解释质量已自动验证。

新答案 ReflectionAnswers：kind=reflection，baseline_run_id/revised_run_id；change={category:goal|constraint|output,quote}；evidence={before/after:{message_id,event_seq,quote,start_offset}}；judgment=satisfied|partial|unsatisfied；explanation；next_instruction（非 satisfied 必须填写）；challenge={challenge_id,judgments:[{item_id,decision:known|confirm}],instruction}。start_offset 是原始正文 Unicode 码点偏移。两轮属于同 Attempt/mode，completed 且有完整非空 message.completed，先后按持久化插入顺序判定。change.quote 必须是第二条原始指令中存在且第一条不存在的非空片段。引用绑定消息和事件并逐码点匹配，不接受渲染或拼接正文。允许 partial/unsatisfied。

ReflectionForm={kind:reflection,prompt,challenge:{id,title,notice,items:[{id,label}]}}。私有正确判断只放 manifest.rules.params。课程规则 evaluator=reflection_pair/reflection_change/reflection_quotes/reflection_challenge，分别给必要项反馈及引用。合法结构但内容不符产生未通过提交；越界 ID、伪造归属应拒绝且无快照。

草稿 GET/PUT /attempts/{attempt_id}/reflection-draft；GET 不存在返回 {attempt_id,revision:0,draft:null,updated_at:null}。PUT={expected_revision,expected_attempt_revision,draft:ReflectionDraftData}，响应同对象，revision+1。ReflectionDraftData 固定字段 step:0..3,beforeId,afterId,beforeMessageId,afterMessageId,beforeStartOffset,afterStartOffset,beforeEventSeq,afterEventSeq,changeKind,requirement,beforeQuote,afterQuote,judgment,explanation,nextInstruction,facts:Record<string,string>,instruction，文本允许空有长度上限。草稿和 Attempt revision 分开，多页面冲突返回 REVISION_CONFLICT；只允许 active reflection 实验写入；历史可读；无模型调用。前端防抖保存，先 GET 再 PUT，同一实验串行保存，失败/离开明显提示，冲突不静默覆盖；提交冻结当前 answers，不能因草稿保存状态误称正式提交。导出包含草稿以及现有正式提交/事件/课程，排除 Key 和模型配置。

Tips 主动确认付费，缓存读取不额外调用；每轮分析本轮运行，主观复盘解释的评价不纳入正式通过。复盘历史显示结构化答案及定位引用。提交成功打开现有弹窗，下一关由学生选择。旧版本选项提交继续工作。

测试覆盖伪造/跨实验/顺序/同钟/重复引用/码点偏移/不同判断、新旧课程并存、自动保存刷新/冲突/重置/旧记录、不可变提交/导出/回滚、移动端及二至四关回归。测试使用本地脚本提供商，无真实 Key；不重启当前体验服务。分支提交、推送和 PR 更新沿用用户此前授权；不直接合并 main。

实施裁定：草稿另存两侧事件序号与 Unicode 码点偏移（初值 0），刷新后恢复学生选择的重复引用位置，不退回第一处匹配。

实施裁定：解释和变式指令须有非空文字作为填写完整性检查；单字也合法，不以字数或关键词评价质量。前端提示与服务端 schema 一致，避免填完四步后收到泛化 422。

实施裁定：Next.js 浏览器后退/前进采用同一页面进程内的临时内存备份，返回时显示未保存恢复提示并暂停自动保存，须由学生处理；不写 localStorage/sessionStorage，不静默覆盖服务器草稿。完整刷新/关闭仍使用未保存离开确认。
