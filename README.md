# (T)ypeScript (I)nterpreter (Syn)tax

Tisyn (pronounced like the Chicken) is a minimal set of interfaces and
constructors to represent an abstract syntax tree that can be
interpreted.

Tisyn expressions do not come with any semantics whatsoever, they
purely express how to compose values by ensuring that the types line
up. This allows language designers to skip the development of their
own syntax while they are figuring out how execution should work.
