# Test Plan

Use this manual test plan after deploying the Worker and setting the backend Worker URL in the frontend.

1. Register student
2. Login student
3. Submit request with multiple files
4. Student sees submitted request
5. Admin loads requests
6. Admin opens oldest request
7. Admin downloads input files
8. Admin copies GPT prompt
9. Admin sets needs_info
10. Student reopens with more info
11. Admin uploads multiple output files
12. Admin marks ready
13. Student downloads output files
14. Admin rejects a test request
15. Rejected request hides from admin list
16. Student can still see rejected request
17. Student cannot access another user's request/file
18. Admin route fails with wrong password

## Notes

- Use only test student accounts and test files.
- Do not test with real secrets in the browser console or committed files.
- Confirm readable JSON errors for wrong passwords, missing login tokens, unsupported file types, oversized files, and cross-user request/file access.
- Confirm the generated GPT prompt includes Student Review Notes instructions before using it outside the app.
