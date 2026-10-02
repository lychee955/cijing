# 句子分析质量验收样例

日期：2026-10-02。下表为人工参考答案和真实模型验收依据，**尚未用真实模型逐条跑通**。接口模拟和结构校验通过不能证明模型的语法质量。

每次选定服务后，先测试连接，再验证单句与短段落；使用本表检查主干、引用范围、修饰对象和引导词作用。允许术语或合理分析不同，不能捏造原文、忽略歧义或把成分讲错。

| # | 类型与输入 | 应核对的分析 |
| --- | --- | --- |
| 1 | 简单主谓宾：`She reads a book every night.` | 主干 She reads a book；She 主语、reads 谓语、a book 宾语；every night 时间状语。 |
| 2 | 系表：`The soup tastes delicious.` | The soup 主语；tastes 系动词；delicious 表语，没有宾语。 |
| 3 | 双宾语：`He gave me a book.` | He gave me a book；me 间接宾语，a book 直接宾语。 |
| 4 | 宾补：`They elected her president.` | They elected her；her 宾语，president 宾语补足语。 |
| 5 | 定语从句：`The book that you lent me is fascinating.` | 主干 The book is fascinating；that you lent me 修饰 book；that 作 lent 的直接宾语；you 主语、lent 谓语、me 间接宾语。 |
| 6 | 名词性从句：`What she said surprised everyone.` | What she said 是主语从句；surprised 谓语、everyone 宾语；What 在从句内作 said 的宾语。 |
| 7 | 状语从句：`Although it was raining, we went out.` | 主干 we went out；Although it was raining 是让步状语从句；Although 是连词，不是从句主语。 |
| 8 | 非谓语：`Seeing the danger, he ran away.` | he ran away 为主干；Seeing the danger 是现在分词短语，逻辑主语 he，表原因或时间，不能虚构有限从句。 |
| 9 | 并列句：`I wanted to stay, but she decided to leave.` | 两个分句分别是 I wanted to stay 和 she decided to leave；but 表转折；to stay/to leave 是非谓语结构。 |
| 10 | 倒装：`Never have I seen such a beautiful sunset.` | 主干 I have seen such a beautiful sunset；Never 前置触发部分倒装，have 为助动词，seen 为实义动词。 |
| 11 | 强调：`It was John who broke the window.` | It was … who 为强调结构，强调 John；基本命题 John broke the window；应解释 who 与被强调主语的关系。 |
| 12 | 歧义：`I saw the man with a telescope.` | with a telescope 可修饰 saw（使用望远镜看见）或 the man（携带望远镜的男人）；不能把一种读法说成唯一正确。 |
| 13 | 段落与指代：`Anna gave Mary a book. She thanked her.` | 首句主干 Anna gave Mary a book；第二句 She thanked her；合理推测 She=Mary、her=Anna，但原文存在其他指代可能，须指出上下文不足。 |
| 14 | 原文错误：`He go to school every day.` | 原文照录；主干 He go to school；单列主谓一致错误，建议 He goes to school every day.，不可先改写原文再定位。 |
| 15 | 重复词：`I think that that idea works.` | 第一个 that 为引导宾语从句的连词，第二个 that 为 idea 的指示限定词；出现序号为 1 和 2，位置必须分别对应。 |
| 16 | 不连续结构：`She has, as you know, finished the work.` | 主干 She has finished the work；谓语 has … finished 允许多个引用片段；as you know 为插入结构，不将其算入谓语片段。 |
| 17 | 嵌套：`I know that you said that birds sing.` | know 的宾语从句 that you said that birds sing；其内部 said 的宾语从句 that birds sing；birds 是最内层主语，父子引用必须包含。 |

## 真实联调记录（待填写）

| 配置与模型 | 连接测试 | 单句 | 短段落 | 上表质量核对 | 日期 |
| --- | --- | --- | --- | --- | --- |
| 当前尚未提供可用 AI 密钥 | 待验证 | 待验证 | 待验证 | 待验证 | — |

密钥应通过应用设置填写，不记录在此文件或测试夹具中。没有墨墨 Token 也可执行上述 AI 验收。
